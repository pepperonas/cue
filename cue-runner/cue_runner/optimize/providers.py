"""Optimizer strategies — the executing half of the provider architecture.

Each provider turns "here is a prompt" into "here is the improved text" and
nothing else: no database, no HTTP to cue, no knowledge of versions, batches or
prompts. Adding an OpenAI / Gemini / Ollama optimizer means implementing
`OptimizerProvider.run()` and registering it here; the server only ever sends a
provider id, so nothing else in the system changes.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("cue-runner.optimize")

# Bearer tokens must never reach the child process (same rule as the run
# executor): the prompt is attacker-influenced text, so keep secrets out.
_RUNNER_SECRETS = {"RUNNER_TOKEN", "CAPTURE_TOKEN"}
# stdout cap for one optimization (1 MiB) — a runaway CLI can't exhaust memory.
_MAX_OUTPUT_BYTES = 1024 * 1024


@dataclass(frozen=True)
class OptimizationOutcome:
    """Normalized result of one attempt, whatever backend produced it."""

    status: str  # succeeded | failed
    text: str | None = None
    model: str = ""
    exit_code: int | None = None
    duration_ms: int | None = None
    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


class OptimizerProvider(Protocol):
    id: str

    async def run(self, prompt: str, *, model: str, timeout_s: float) -> OptimizationOutcome: ...


def child_env() -> dict[str, str]:
    """Environment for the child: runner secrets and CUE_* config stripped."""
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in _RUNNER_SECRETS and not k.startswith("CUE_")
    }
    env["CUE_NO_CAPTURE"] = "1"  # never re-capture the runner's own claude calls
    return env


class ClaudeCliService:
    """Runs the locally installed Claude Code CLI.

    Responsibilities are deliberately narrow: build the argv, spawn the
    process, enforce the timeout, parse the output, report exit code + stderr.
    Nothing here touches cue's API or database.

    Invocation (CLI v2.1.220): `claude -p <prompt> --output-format json`, which
    prints ONE JSON object carrying `result` (the answer text), `total_cost_usd`,
    `duration_ms`, `usage` and `modelUsage`. The prompt travels as its own argv
    element — there is no shell, so no interpolation and no injection surface.
    """

    id = "claude_cli"

    def __init__(self, claude_path: str = "claude", spawn=None) -> None:
        self.claude_path = claude_path
        # Injected in tests; defaults to a real subprocess.
        self._spawn = spawn or self._spawn_process

    def build_argv(self, prompt: str, model: str) -> list[str]:
        argv = [self.claude_path, "-p", prompt, "--output-format", "json"]
        # A model must never be able to smuggle extra flags.
        if model and not model.startswith("-"):
            argv += ["--model", model]
        return argv

    async def _spawn_process(self, argv: list[str]):  # noqa: ANN202
        return await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,  # the CLI waits on stdin otherwise
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=child_env(),
            cwd=os.path.expanduser("~"),
            start_new_session=True,  # own process group -> kill the whole tree
        )

    async def run(self, prompt: str, *, model: str = "", timeout_s: float = 180.0) -> OptimizationOutcome:
        started = time.monotonic()
        argv = self.build_argv(prompt, model)
        try:
            proc = await self._spawn(argv)
        except FileNotFoundError:
            return OptimizationOutcome(
                status="failed", error=f"Claude CLI nicht gefunden ({self.claude_path})"
            )
        except OSError as exc:
            return OptimizationOutcome(status="failed", error=f"CLI-Start fehlgeschlagen: {exc}")

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except asyncio.TimeoutError:
            await _terminate(proc)
            return OptimizationOutcome(
                status="failed",
                exit_code=None,
                duration_ms=_elapsed_ms(started),
                error=f"Zeitüberschreitung nach {int(timeout_s)} s",
            )

        duration_ms = _elapsed_ms(started)
        exit_code = proc.returncode
        err_text = _decode(stderr)[:800]
        if exit_code != 0:
            return OptimizationOutcome(
                status="failed",
                exit_code=exit_code,
                duration_ms=duration_ms,
                error=err_text or f"CLI beendet mit Exit-Code {exit_code}",
            )

        parsed = self.parse_output(_decode(stdout))
        if parsed.get("error"):
            return OptimizationOutcome(
                status="failed",
                exit_code=exit_code,
                duration_ms=duration_ms,
                error=parsed["error"],
            )
        return OptimizationOutcome(
            status="succeeded",
            text=parsed.get("text") or None,
            model=parsed.get("model", "") or model,
            exit_code=exit_code,
            duration_ms=parsed.get("duration_ms") or duration_ms,
            cost_usd=parsed.get("cost_usd"),
            input_tokens=parsed.get("input_tokens"),
            output_tokens=parsed.get("output_tokens"),
        )

    @staticmethod
    def parse_output(raw: str) -> dict:
        """Read the CLI's `--output-format json` envelope.

        Tolerant on purpose: warning lines may precede the JSON ("no stdin data
        received…"), and a future CLI could print plain text — in that case the
        raw output IS the answer rather than a hard failure.
        """
        text = (raw or "").strip()
        if not text:
            return {"error": "CLI lieferte keine Ausgabe"}
        payload = None
        start = text.find("{")
        if start != -1:
            with contextlib.suppress(json.JSONDecodeError):
                payload = json.loads(text[start:])
        if not isinstance(payload, dict):
            return {"text": text}  # plain-text fallback
        if payload.get("is_error"):
            return {
                "error": str(payload.get("result") or payload.get("error") or "CLI meldete einen Fehler")[:800]
            }
        usage = payload.get("usage") or {}
        models = payload.get("modelUsage") or {}
        return {
            "text": str(payload.get("result") or "").strip(),
            "model": next(iter(models), "") if isinstance(models, dict) else "",
            "cost_usd": _as_float(payload.get("total_cost_usd")),
            "duration_ms": _as_int(payload.get("duration_ms")),
            "input_tokens": _as_int(usage.get("input_tokens")),
            "output_tokens": _as_int(usage.get("output_tokens")),
        }


def _decode(data: bytes | None) -> str:
    if not data:
        return ""
    return data[:_MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _as_float(value) -> float | None:  # noqa: ANN001
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value) -> int | None:  # noqa: ANN001
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def _terminate(proc) -> None:  # noqa: ANN001
    """SIGTERM the whole group, escalate to SIGKILL after a grace period."""
    if getattr(proc, "returncode", None) is not None:
        return
    pid = getattr(proc, "pid", None)
    with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
        if pid is not None:
            os.killpg(os.getpgid(pid), 15)
        else:
            proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            if pid is not None:
                os.killpg(os.getpgid(pid), 9)
            else:
                proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()


_REGISTRY: dict[str, OptimizerProvider] = {}


def register(provider: OptimizerProvider) -> None:
    _REGISTRY[provider.id] = provider


def build_registry(claude_path: str) -> dict[str, OptimizerProvider]:
    """Providers this runner can execute. Future backends are added here."""
    return {ClaudeCliService.id: ClaudeCliService(claude_path)}


def get(provider_id: str, claude_path: str) -> OptimizerProvider | None:
    if provider_id in _REGISTRY:
        return _REGISTRY[provider_id]
    return build_registry(claude_path).get(provider_id)
