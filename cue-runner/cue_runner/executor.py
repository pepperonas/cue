"""Execute a run's steps via the Claude Code CLI subprocess."""
from __future__ import annotations

import asyncio
import contextlib
import os
import uuid
from dataclasses import dataclass

# The runner's own claude invocations must not be re-captured by the hook.
_CHILD_ENV = {**os.environ, "CUE_NO_CAPTURE": "1"}

from .api import RunnerApi
from .command import build_command
from .config import Config
from .paths import is_path_allowed
from .stream import is_result, parse_line, session_id_of, summarize

_LOG_BATCH = 20


@dataclass
class StepOutcome:
    status: str  # succeeded | failed | canceled
    output: str | None = None
    cost: float | None = None
    exit_code: int | None = None
    session_id: str | None = None


async def _terminate(proc) -> None:
    if proc.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
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
        env=_CHILD_ENV,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    log_buf: list[tuple[str, str]] = []
    result_event: dict | None = None
    seen_session: str | None = None

    async def flush() -> None:
        if not log_buf:
            return
        batch, log_buf[:] = log_buf[:], []
        with contextlib.suppress(Exception):
            await api.append_log(run["id"], step_index, batch)

    async def reader() -> None:
        nonlocal result_event, seen_session
        assert proc.stdout is not None
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
