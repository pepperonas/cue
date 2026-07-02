"""Execute a run's steps via the Claude Code CLI subprocess."""
from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import uuid
from dataclasses import dataclass

from .api import RunnerApi
from .command import build_command
from .config import Config
from .paths import is_path_allowed
from .stream import is_result, parse_line, session_id_of, summarize

_LOG_BATCH = 20
# StreamReader line-length cap: a single stream-json event (e.g. a large tool
# result) can far exceed the 64 KiB default, which would otherwise crash the
# reader with LimitOverrunError.
_STREAM_LIMIT = 64 * 1024 * 1024
# The runner's own bearer tokens must never reach the claude subprocess: a run's
# prompt/tools are server-supplied, so a malicious step could otherwise read them
# from the environment. Strip the runner secrets + its own CUE_* config.
_RUNNER_SECRETS = {"RUNNER_TOKEN", "CAPTURE_TOKEN"}


def _child_env() -> dict:
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in _RUNNER_SECRETS and not k.startswith("CUE_")
    }
    env["CUE_NO_CAPTURE"] = "1"  # the runner's own claude runs must not be re-captured
    return env


@dataclass
class StepOutcome:
    status: str  # succeeded | failed | canceled
    output: str | None = None
    cost: float | None = None
    exit_code: int | None = None
    session_id: str | None = None


def _signal_tree(proc, sig) -> None:
    """Signal the child's whole process group (it's a session leader via
    start_new_session), so tool-spawned grandchildren die too instead of being
    orphaned. Falls back to the direct child (e.g. test fakes with no pid)."""
    pid = getattr(proc, "pid", None)
    if pid is not None:
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(os.getpgid(pid), sig)
            return
    with contextlib.suppress(ProcessLookupError):
        (proc.kill if sig == signal.SIGKILL else proc.terminate)()


async def _terminate(proc) -> None:
    if proc.returncode is not None:
        return
    _signal_tree(proc, signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        _signal_tree(proc, signal.SIGKILL)
        await proc.wait()


async def execute_step(
    cfg: Config,
    api: RunnerApi,
    run: dict,
    step_index: int,
    prompt: str,
    session_id: str,
    cancel_event: asyncio.Event,
    spawn=None,
) -> StepOutcome:
    argv = build_command(cfg, run, step_index, prompt, session_id)
    spawn = spawn or asyncio.create_subprocess_exec
    proc = await spawn(
        *argv,
        cwd=run["project_path"],
        env=_child_env(),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,  # own process group -> cancel/timeout reaps the whole tree
        limit=_STREAM_LIMIT,
    )

    log_buf: list[tuple[str, str]] = []
    result_event: dict | None = None
    seen_session: str | None = None
    read_error: Exception | None = None

    async def flush() -> None:
        if not log_buf:
            return
        batch, log_buf[:] = log_buf[:], []
        with contextlib.suppress(Exception):
            await api.append_log(run["id"], step_index, batch)

    async def reader() -> None:
        nonlocal result_event, seen_session, read_error
        assert proc.stdout is not None
        try:
            async for raw in proc.stdout:
                event = parse_line(raw.decode("utf-8", "replace"))
                if event is None:
                    continue
                if seen_session is None:
                    seen_session = session_id_of(event)
                if is_result(event):
                    result_event = event
                log_buf.append(summarize(event))
                if len(log_buf) >= _LOG_BATCH:
                    await flush()
        except Exception as exc:  # noqa: BLE001 — surface as a failed step, don't swallow
            read_error = exc

    reader_task = asyncio.create_task(reader())
    loop = asyncio.get_event_loop()
    start = loop.time()
    canceled = timed_out = False
    while True:
        if cancel_event.is_set():
            canceled = True
            break
        done, _ = await asyncio.wait({reader_task}, timeout=0.5)
        if reader_task in done:
            break
        if loop.time() - start > cfg.run_timeout:
            timed_out = True
            break

    if canceled or timed_out:
        await _terminate(proc)
        reader_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader_task
        await flush()
        return StepOutcome(
            status="canceled" if canceled else "failed",
            session_id=seen_session,
            exit_code=proc.returncode,
        )

    await proc.wait()
    await flush()
    exit_code = proc.returncode
    sid = seen_session or session_id
    if read_error is not None:
        with contextlib.suppress(Exception):
            await api.append_log(
                run["id"], step_index, [("error", f"stream read error: {read_error}")]
            )
        return StepOutcome(status="failed", exit_code=exit_code, session_id=sid)
    if result_event is not None:
        is_err = bool(result_event.get("is_error")) or exit_code not in (0, None)
        return StepOutcome(
            status="failed" if is_err else "succeeded",
            output=str(result_event.get("result", "")) or None,
            cost=result_event.get("total_cost_usd"),
            exit_code=exit_code,
            session_id=sid,
        )
    return StepOutcome(
        status="succeeded" if exit_code in (0, None) else "failed",
        exit_code=exit_code,
        session_id=sid,
    )


async def execute_run(
    cfg: Config, api: RunnerApi, run: dict, cancel_event: asyncio.Event, spawn=None
) -> None:
    run_id = run["id"]
    project_path = run.get("project_path", "")
    if not is_path_allowed(project_path, cfg.allowed_bases) or not os.path.isdir(project_path):
        await api.run_result(run_id, "failed", error="project_path not allowed or missing")
        return
    # Re-check the fully resolved path: the lexical whitelist above can be escaped
    # by a symlink inside an allowed base pointing elsewhere.
    real_path = os.path.realpath(project_path)
    real_bases = [os.path.realpath(b) for b in cfg.allowed_bases]
    if not is_path_allowed(real_path, real_bases):
        await api.run_result(run_id, "failed", error="project_path escapes allowed bases")
        return

    steps = sorted(run.get("steps", []), key=lambda s: s["step_index"])
    session_id = str(uuid.uuid4())
    total_cost = 0.0
    any_failed = False
    stopped = False  # a prior step failed and stop_on_error is set

    for step in steps:
        idx = step["step_index"]
        if cancel_event.is_set() or stopped:
            await api.step_result(run_id, idx, "canceled")
            continue

        outcome = await execute_step(
            cfg, api, run, idx, step.get("prompt_text", ""), session_id, cancel_event, spawn=spawn
        )
        await api.step_result(
            run_id,
            idx,
            outcome.status,
            claude_session_id=outcome.session_id or session_id,
            output=outcome.output,
            exit_code=outcome.exit_code,
            cost_usd=outcome.cost,
        )
        if outcome.cost:
            total_cost += outcome.cost
        if outcome.status == "canceled":
            await api.run_result(run_id, "canceled", total_cost_usd=total_cost or None)
            return
        if outcome.status == "failed":
            any_failed = True
            if run.get("stop_on_error", True):
                stopped = True

    status = "canceled" if cancel_event.is_set() else ("failed" if any_failed else "succeeded")
    await api.run_result(run_id, status, total_cost_usd=total_cost or None)
