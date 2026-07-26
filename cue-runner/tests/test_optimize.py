"""Optimization worker: CLI service, output parsing, timeouts, the loop.

Every subprocess is faked — the suite never spawns `claude` and never touches
the network.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from cue_runner.config import Config
from cue_runner.optimize import ClaudeCliService, optimize_one, run_next
from cue_runner.optimize.providers import OptimizationOutcome, build_registry, get


def cfg(**over) -> Config:
    base = dict(
        api_url="http://api",
        runner_token="t",
        allowed_bases=["/Users/martin/claude"],
        claude_path="/usr/local/bin/claude",
        optimize_timeout=30.0,
        optimize_max_chars=1000,
    )
    base.update(over)
    return Config(**base)


class FakeProc:
    """Minimal asyncio.subprocess stand-in."""

    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0, hang: bool = False):
        self._stdout, self._stderr, self.returncode = stdout, stderr, returncode
        self._hang = hang
        self.pid = None  # keeps _terminate on the proc.terminate() path
        self.terminated = False
        self.killed = False

    async def communicate(self):
        if self._hang:
            await asyncio.sleep(3600)
        return self._stdout, self._stderr

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        return self.returncode


def result_json(**over) -> bytes:
    payload = {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "result": "Ein optimierter Prompt",
        "total_cost_usd": 0.0175,
        "duration_ms": 2523,
        "usage": {"input_tokens": 10, "output_tokens": 68},
        "modelUsage": {"claude-sonnet-4-5": {"costUSD": 0.0175}},
    }
    payload.update(over)
    return json.dumps(payload).encode()


# ------------------------------------------------------------- argv building


def test_argv_has_no_shell_and_carries_the_prompt_as_one_argument():
    svc = ClaudeCliService("/usr/local/bin/claude")
    argv = svc.build_argv("Text mit \"Quotes\"; rm -rf / && echo pwned", "")
    assert argv[0] == "/usr/local/bin/claude"
    assert argv[1] == "-p"
    # The whole payload is ONE element — nothing is ever interpreted by a shell.
    assert argv[2] == 'Text mit "Quotes"; rm -rf / && echo pwned'
    assert argv[3:] == ["--output-format", "json"]


def test_argv_appends_a_model_but_refuses_flag_lookalikes():
    svc = ClaudeCliService()
    assert svc.build_argv("x", "sonnet")[-2:] == ["--model", "sonnet"]
    assert "--model" not in svc.build_argv("x", "--dangerously-skip-permissions")


# ------------------------------------------------------------ output parsing


def test_parse_output_reads_the_json_envelope():
    parsed = ClaudeCliService.parse_output(result_json().decode())
    assert parsed["text"] == "Ein optimierter Prompt"
    assert parsed["cost_usd"] == 0.0175
    assert parsed["duration_ms"] == 2523
    assert parsed["input_tokens"] == 10 and parsed["output_tokens"] == 68
    assert parsed["model"] == "claude-sonnet-4-5"


def test_parse_output_skips_leading_warning_lines():
    raw = "Warning: no stdin data received in 3s, proceeding without it.\n" + result_json().decode()
    assert ClaudeCliService.parse_output(raw)["text"] == "Ein optimierter Prompt"


def test_parse_output_handles_error_envelopes_and_empty_output():
    err = ClaudeCliService.parse_output(result_json(is_error=True, result="Rate limited").decode())
    assert err["error"] == "Rate limited"
    assert "error" in ClaudeCliService.parse_output("")
    assert "error" in ClaudeCliService.parse_output("   ")


def test_parse_output_falls_back_to_plain_text():
    # A future CLI printing bare text must not break the feature.
    assert ClaudeCliService.parse_output("Nur Text")["text"] == "Nur Text"
    assert ClaudeCliService.parse_output("{kaputt")["text"] == "{kaputt"


# ------------------------------------------------------------------ running


@pytest.mark.asyncio
async def test_run_returns_a_normalized_outcome():
    svc = ClaudeCliService(spawn=lambda argv: _spawned(FakeProc(stdout=result_json())))
    out = await svc.run("prompt", model="", timeout_s=5)
    assert out.status == "succeeded"
    assert out.text == "Ein optimierter Prompt"
    assert out.exit_code == 0 and out.cost_usd == 0.0175
    assert out.input_tokens == 10 and out.model == "claude-sonnet-4-5"


@pytest.mark.asyncio
async def test_nonzero_exit_reports_stderr():
    proc = FakeProc(stdout=b"", stderr=b"Not logged in", returncode=1)
    svc = ClaudeCliService(spawn=lambda argv: _spawned(proc))
    out = await svc.run("prompt", timeout_s=5)
    assert out.status == "failed" and out.exit_code == 1
    assert out.error == "Not logged in"
    assert out.duration_ms is not None


@pytest.mark.asyncio
async def test_timeout_kills_the_process_and_reports_it():
    # returncode=None -> the process is still alive, so it must be signalled.
    proc = FakeProc(hang=True, returncode=None)
    svc = ClaudeCliService(spawn=lambda argv: _spawned(proc))
    out = await svc.run("prompt", timeout_s=0.05)
    assert out.status == "failed"
    assert "Zeitüberschreitung" in out.error
    assert proc.terminated or proc.killed


@pytest.mark.asyncio
async def test_missing_cli_binary_is_a_clean_failure():
    async def boom(argv):
        raise FileNotFoundError(argv[0])

    out = await ClaudeCliService("/nope/claude", spawn=boom).run("p", timeout_s=1)
    assert out.status == "failed" and "nicht gefunden" in out.error


@pytest.mark.asyncio
async def test_os_error_on_spawn_is_reported():
    async def boom(argv):
        raise OSError("too many open files")

    out = await ClaudeCliService(spawn=boom).run("p", timeout_s=1)
    assert out.status == "failed" and "CLI-Start" in out.error


# ------------------------------------------------------------- provider wiring


def test_registry_exposes_the_claude_cli_provider():
    registry = build_registry("/bin/claude")
    assert set(registry) == {"claude_cli"}
    assert registry["claude_cli"].claude_path == "/bin/claude"
    assert get("claude_cli", "/bin/claude") is not None
    assert get("openai", "/bin/claude") is None


@pytest.mark.asyncio
async def test_optimize_one_rejects_an_unknown_provider():
    out = await optimize_one(cfg(), None, {"provider": "gemini", "prompt": "x"})
    assert out.status == "failed" and "Unbekannter Optimizer" in out.error


@pytest.mark.asyncio
async def test_optimize_one_enforces_the_size_limit():
    job = {"provider": "claude_cli", "prompt": "x" * 50, "max_chars": 10}
    out = await optimize_one(cfg(), None, job)
    assert out.status == "failed" and "Limit" in out.error


@pytest.mark.asyncio
async def test_optimize_one_retries_a_failing_attempt(monkeypatch):
    calls = {"n": 0}

    class Flaky:
        id = "claude_cli"

        async def run(self, prompt, *, model="", timeout_s=0):
            calls["n"] += 1
            if calls["n"] == 1:
                return OptimizationOutcome(status="failed", error="transient")
            return OptimizationOutcome(status="succeeded", text="ok")

    monkeypatch.setattr("cue_runner.optimize.loop.get_provider", lambda *_: Flaky())
    out = await optimize_one(cfg(), None, {"provider": "claude_cli", "prompt": "p", "max_retries": 1})
    assert out.status == "succeeded" and calls["n"] == 2


# ------------------------------------------------------------------ the loop


class FakeApi:
    def __init__(self, jobs):
        self.jobs = list(jobs)
        self.results = []

    async def claim_optimization(self):
        return self.jobs.pop(0) if self.jobs else None

    async def optimization_result(self, optimization_id, **payload):
        self.results.append({"id": optimization_id, **payload})


@pytest.mark.asyncio
async def test_run_next_reports_success(monkeypatch):
    monkeypatch.setattr(
        "cue_runner.optimize.loop.get_provider",
        lambda *_: _Static(OptimizationOutcome(status="succeeded", text="besser", model="m", duration_ms=12)),
    )
    api = FakeApi([{"id": 7, "provider": "claude_cli", "prompt": "p", "prompt_id": 3, "version": 1}])
    assert await run_next(cfg(), api) is True
    assert api.results == [
        {
            "id": 7,
            "status": "succeeded",
            "optimized_text": "besser",
            "model": "m",
            "exit_code": None,
            "duration_ms": 12,
            "cost_usd": None,
            "input_tokens": None,
            "output_tokens": None,
            "error": None,
        }
    ]
    # Queue empty afterwards -> the loop idles instead of spinning.
    assert await run_next(cfg(), api) is False


@pytest.mark.asyncio
async def test_run_next_always_resolves_a_claimed_job_even_on_a_crash(monkeypatch):
    class Exploding:
        id = "claude_cli"

        async def run(self, *a, **kw):
            raise RuntimeError("boom")

    monkeypatch.setattr("cue_runner.optimize.loop.get_provider", lambda *_: Exploding())
    api = FakeApi([{"id": 9, "provider": "claude_cli", "prompt": "p"}])
    assert await run_next(cfg(), api) is True
    assert api.results[0]["status"] == "failed"
    assert "Runner-Fehler" in api.results[0]["error"]


class _Static:
    id = "claude_cli"

    def __init__(self, outcome):
        self.outcome = outcome

    async def run(self, prompt, *, model="", timeout_s=0):
        return self.outcome


async def _spawned(proc):
    return proc
