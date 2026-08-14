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
from cue_runner.optimize.loop import _non_retryable
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


def test_an_empty_model_omits_the_flag_entirely():
    """That omission is a decision, not an oversight: it hands the choice to
    whatever the CLI on this Mac is set to. cue ran that way until 0.39.0 and
    optimized prompts with two different models on two different days without
    anything in the UI saying so — hence `OPTIMIZE_MODEL` on the server side.
    Passing an empty `--model` would be worse than either: an error, not a
    default."""
    svc = ClaudeCliService()
    argv = svc.build_argv("x", "")
    assert "--model" not in argv
    assert "" not in argv[3:]


def test_aliases_and_full_names_travel_unchanged():
    """`opus` follows the newest of that line, `claude-opus-5` pins exactly —
    the runner must not normalise either into the other."""
    svc = ClaudeCliService()
    for model in ("opus", "fable", "sonnet", "claude-opus-5", "claude-fable-5"):
        assert svc.build_argv("x", model)[-2:] == ["--model", model]


@pytest.mark.asyncio
async def test_the_claimed_model_is_what_gets_executed():
    """The job's model has to survive the trip from the claim into argv —
    a server-side pin the runner drops is a pin in name only."""
    seen: list[list[str]] = []

    def spawn(argv):
        seen.append(list(argv))
        return _spawned(FakeProc(stdout=result_json()))

    svc = ClaudeCliService(spawn=spawn)
    await svc.run("prompt", model="opus", timeout_s=5)

    assert seen and seen[0][-2:] == ["--model", "opus"]


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
async def test_nonzero_exit_prefers_stdout_json_error_over_generic_message():
    # Real Claude CLI behaviour on a weekly-quota hit: exit 1, empty stderr,
    # error text only inside the JSON envelope on stdout.
    body = result_json(
        is_error=True,
        result="You've hit your weekly limit · resets Aug 2 at 1am (Europe/Berlin)",
        api_error_status=429,
    )
    proc = FakeProc(stdout=body, stderr=b"", returncode=1)
    svc = ClaudeCliService(spawn=lambda argv: _spawned(proc))
    out = await svc.run("prompt", timeout_s=5)
    assert out.status == "failed" and out.exit_code == 1
    assert "weekly limit" in (out.error or "")
    assert "Exit-Code" not in (out.error or "")


@pytest.mark.asyncio
async def test_exit_zero_with_is_error_envelope_is_still_a_failure():
    body = result_json(is_error=True, result="Failed to authenticate")
    proc = FakeProc(stdout=body, stderr=b"", returncode=0)
    out = await ClaudeCliService(spawn=lambda argv: _spawned(proc)).run("p", timeout_s=5)
    assert out.status == "failed"
    assert "authenticate" in (out.error or "").lower()


@pytest.mark.asyncio
async def test_empty_stdout_with_stderr_prefers_stderr_over_synthetic_message():
    proc = FakeProc(stdout=b"", stderr=b"permission denied", returncode=2)
    out = await ClaudeCliService(spawn=lambda argv: _spawned(proc)).run("p", timeout_s=5)
    assert out.error == "permission denied"


@pytest.mark.asyncio
async def test_nonzero_exit_with_empty_streams_reports_missing_output():
    # Empty stdout → parse_output's synthetic message beats the bare exit code.
    proc = FakeProc(stdout=b"", stderr=b"", returncode=1)
    out = await ClaudeCliService(spawn=lambda argv: _spawned(proc)).run("p", timeout_s=5)
    assert out.status == "failed" and out.exit_code == 1
    assert out.error == "CLI lieferte keine Ausgabe"


@pytest.mark.asyncio
async def test_json_error_beats_stderr_when_both_are_present():
    body = result_json(is_error=True, result="You've hit your weekly limit")
    proc = FakeProc(stdout=body, stderr=b"also on stderr", returncode=1)
    out = await ClaudeCliService(spawn=lambda argv: _spawned(proc)).run("p", timeout_s=5)
    assert "weekly limit" in (out.error or "")
    assert "stderr" not in (out.error or "")


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


@pytest.mark.asyncio
async def test_optimize_one_skips_retry_on_weekly_quota(monkeypatch):
    calls = {"n": 0}

    class Quota:
        id = "claude_cli"

        async def run(self, prompt, *, model="", timeout_s=0):
            calls["n"] += 1
            return OptimizationOutcome(
                status="failed",
                error="You've hit your weekly limit · resets Aug 2 at 1am",
            )

    monkeypatch.setattr("cue_runner.optimize.loop.get_provider", lambda *_: Quota())
    out = await optimize_one(cfg(), None, {"provider": "claude_cli", "prompt": "p", "max_retries": 1})
    assert out.status == "failed" and calls["n"] == 1
    assert "weekly limit" in (out.error or "")


@pytest.mark.parametrize(
    "error",
    [
        "You've hit your weekly limit",
        "Rate limited — try again later",
        "HTTP 429: too many requests",
        "Claude CLI nicht gefunden (/usr/bin/claude)",
        "Not logged in",
        "Failed to authenticate. API Error: 403",
        "invalid api key",
        "Credit balance is too low",
        "usage limit exceeded",
    ],
)
def test_non_retryable_recognises_quota_and_auth_failures(error):
    assert _non_retryable(error) is True


@pytest.mark.parametrize(
    "error",
    [
        None,
        "",
        "transient network blip",
        "stream ended unexpectedly",
        "CLI lieferte keine Ausgabe",
        "Zeitüberschreitung nach 180 s",
    ],
)
def test_non_retryable_lets_transient_errors_through(error):
    assert _non_retryable(error) is False


@pytest.mark.asyncio
async def test_optimize_one_skips_retry_on_auth_failure(monkeypatch):
    calls = {"n": 0}

    class AuthFail:
        id = "claude_cli"

        async def run(self, prompt, *, model="", timeout_s=0):
            calls["n"] += 1
            return OptimizationOutcome(status="failed", error="Failed to authenticate")

    monkeypatch.setattr("cue_runner.optimize.loop.get_provider", lambda *_: AuthFail())
    out = await optimize_one(cfg(), None, {"provider": "claude_cli", "prompt": "p", "max_retries": 3})
    assert out.status == "failed" and calls["n"] == 1


@pytest.mark.asyncio
async def test_optimize_one_still_retries_transient_errors(monkeypatch):
    calls = {"n": 0}

    class Flaky:
        id = "claude_cli"

        async def run(self, prompt, *, model="", timeout_s=0):
            calls["n"] += 1
            return OptimizationOutcome(status="failed", error="stream ended unexpectedly")

    monkeypatch.setattr("cue_runner.optimize.loop.get_provider", lambda *_: Flaky())
    out = await optimize_one(cfg(), None, {"provider": "claude_cli", "prompt": "p", "max_retries": 2})
    assert out.status == "failed" and calls["n"] == 3  # 1 + 2 retries


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
