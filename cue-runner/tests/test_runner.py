"""Runner unit tests — subprocess + HTTP are faked."""
from __future__ import annotations

import asyncio
import json

import pytest

from cue_runner import executor
from cue_runner.command import build_command
from cue_runner.config import Config
from cue_runner.executor import execute_run, execute_step
from cue_runner.paths import is_path_allowed
from cue_runner.stream import is_result, parse_line, session_id_of, summarize


def _cfg(bases=None) -> Config:
    return Config(
        api_url="http://x",
        runner_token="t",
        allowed_bases=bases or ["/Users/martin/claude"],
        run_timeout=5.0,
    )


# ---- pure helpers ----
def test_path_whitelist():
    bases = ["/Users/martin/claude"]
    assert is_path_allowed("/Users/martin/claude/cue", bases)
    assert is_path_allowed("/Users/martin/claude", bases)
    assert not is_path_allowed("/etc", bases)
    assert not is_path_allowed("/Users/martin/claude/../secret", bases)
    assert not is_path_allowed("relative/path", bases)
    assert not is_path_allowed("/Users/martin/claudex", bases)  # prefix, not a subdir


def test_build_command_chain_threading():
    cfg = _cfg()
    run = {
        "model": "opus",
        "allowed_tools": "Read, Edit,Bash",
        "permission_mode": "acceptEdits",
        "bare": True,
        "skip_permissions": False,
    }
    a0 = build_command(cfg, run, 0, "hi", "sess-123")
    assert "--session-id" in a0 and "sess-123" in a0 and "--resume" not in a0
    assert a0[a0.index("--allowedTools") + 1 : a0.index("--allowedTools") + 4] == ["Read", "Edit", "Bash"]
    assert "--model" in a0 and "--permission-mode" in a0 and "--bare" in a0
    assert "--dangerously-skip-permissions" not in a0

    a1 = build_command(cfg, run, 1, "next", "sess-123")
    assert "--resume" in a1 and "sess-123" in a1 and "--session-id" not in a1


def test_allowed_tools_rejects_flag_injection():
    """A compromised server must not smuggle extra claude flags via allowed_tools."""
    cfg = _cfg()
    run = {"allowed_tools": "Bash --dangerously-skip-permissions -x"}
    argv = build_command(cfg, run, 0, "hi", "sess")
    assert "--dangerously-skip-permissions" not in argv
    assert "-x" not in argv
    assert argv[argv.index("--allowedTools") + 1] == "Bash"


def test_stream_parsing():
    init = parse_line(json.dumps({"type": "system", "subtype": "init", "session_id": "s1"}))
    assert session_id_of(init) == "s1"
    asst = parse_line(
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "pong"}]}})
    )
    assert summarize(asst) == ("assistant", "pong")
    res = parse_line(json.dumps({"type": "result", "subtype": "success", "result": "pong", "total_cost_usd": 0.01}))
    assert is_result(res)
    assert parse_line("not json") is None


# ---- fakes ----
class FakeStdout:
    def __init__(self, lines, hang: asyncio.Event | None):
        self._lines = [l.encode() for l in lines]
        self._i = 0
        self._hang = hang

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i < len(self._lines):
            line = self._lines[self._i]
            self._i += 1
            return line
        if self._hang is not None:
            await self._hang.wait()
        raise StopAsyncIteration


class FakeProc:
    def __init__(self, lines, hang=False):
        self._hang = asyncio.Event() if hang else None
        self.stdout = FakeStdout(lines, self._hang)
        self.returncode = None
        self.terminated = False
        self.killed = False

    def terminate(self):
        self.terminated = True
        self.returncode = -15
        if self._hang:
            self._hang.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        if self._hang:
            self._hang.set()

    async def wait(self):
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


def _spawn_factory(proc, recorder=None):
    async def spawn(*argv, **kwargs):
        if recorder is not None:
            recorder["argv"] = list(argv)
            recorder["cwd"] = kwargs.get("cwd")
        return proc

    return spawn


class FakeApi:
    def __init__(self):
        self.logs = []
        self.steps = []
        self.runs = []

    async def append_log(self, run_id, idx, batch):
        self.logs.append((idx, batch))

    async def step_result(self, run_id, idx, status, **kw):
        self.steps.append((idx, status, kw))

    async def run_result(self, run_id, status, **kw):
        self.runs.append((status, kw))


# ---- execution ----
async def test_execute_step_success():
    lines = [
        json.dumps({"type": "system", "subtype": "init", "session_id": "s9"}) + "\n",
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "pong"}]}, "session_id": "s9"}) + "\n",
        json.dumps({"type": "result", "subtype": "success", "session_id": "s9", "is_error": False, "result": "pong", "total_cost_usd": 0.03}) + "\n",
    ]
    proc = FakeProc(lines)
    api = FakeApi()
    run = {"id": "r1", "project_path": "/Users/martin/claude/cue"}
    out = await execute_step(_cfg(), api, run, 0, "hi", "sess", asyncio.Event(), spawn=_spawn_factory(proc))
    assert out.status == "succeeded"
    assert out.output == "pong"
    assert out.cost == 0.03
    assert out.session_id == "s9"
    assert api.logs  # logs were flushed


async def test_execute_step_cancel_kills_subprocess():
    proc = FakeProc(["{}\n"], hang=True)  # never reaches EOF on its own
    api = FakeApi()
    run = {"id": "r1", "project_path": "/Users/martin/claude/cue"}
    cancel = asyncio.Event()
    cancel.set()
    out = await execute_step(_cfg(), api, run, 0, "hi", "sess", cancel, spawn=_spawn_factory(proc))
    assert out.status == "canceled"
    assert proc.terminated is True  # subprocess was killed -> no orphan


async def test_execute_run_stop_on_error(monkeypatch, tmp_path):
    cfg = _cfg(bases=[str(tmp_path)])
    api = FakeApi()
    run = {
        "id": "r2",
        "project_path": str(tmp_path),
        "stop_on_error": True,
        "steps": [
            {"step_index": 0, "prompt_text": "a"},
            {"step_index": 1, "prompt_text": "b"},
        ],
    }

    async def fake_step(*a, **k):
        return executor.StepOutcome(status="failed", exit_code=1, session_id="s")

    monkeypatch.setattr(executor, "execute_step", fake_step)
    await execute_run(cfg, api, run, asyncio.Event())

    statuses = {idx: status for idx, status, _ in api.steps}
    assert statuses[0] == "failed"
    assert statuses[1] == "canceled"  # follow-up step skipped
    assert api.runs[-1][0] == "failed"


async def test_execute_run_rejects_bad_path(tmp_path):
    cfg = _cfg(bases=["/Users/martin/claude"])
    api = FakeApi()
    run = {"id": "r3", "project_path": "/etc", "steps": [{"step_index": 0, "prompt_text": "x"}]}
    await execute_run(cfg, api, run, asyncio.Event())
    assert api.runs[-1][0] == "failed"
    assert not api.steps  # never executed


async def test_deliver_iterm_builds_argv(monkeypatch):
    from cue_runner import deliver

    calls = []

    async def fake_run(argv, stdin=None):
        calls.append({"argv": argv, "stdin": stdin})
        return 0, "ok"

    monkeypatch.setattr(deliver, "_run", fake_run)
    status, err = await deliver.deliver_one(
        {"transport": "iterm", "iterm_session_id": "w0t1p0:DEADBEEF0123", "text": "hello", "submit": True}
    )
    assert status == "sent" and err is None
    argv = calls[0]["argv"]
    assert argv[0] == "osascript"
    assert argv[2] == "DEADBEEF0123"  # GUID extracted from ITERM_SESSION_ID
    assert argv[3] == "hello" and argv[4] == "1"  # text + submit flag, no interpolation
    assert calls[0]["stdin"] is not None  # AppleScript fed via stdin


async def test_deliver_iterm_rejects_bad_guid(monkeypatch):
    from cue_runner import deliver

    async def fake_run(argv, stdin=None):
        raise AssertionError("must not spawn for invalid id")

    monkeypatch.setattr(deliver, "_run", fake_run)
    status, err = await deliver.deliver_one({"transport": "iterm", "iterm_session_id": "x:--evil", "text": "hi"})
    assert status == "failed" and "invalid" in err


async def test_deliver_tmux_bracketed_paste(monkeypatch):
    from cue_runner import deliver

    calls = []

    async def fake_run(argv, stdin=None):
        calls.append(argv)
        return 0, ""

    monkeypatch.setattr(deliver, "_run", fake_run)
    status, err = await deliver.deliver_one(
        {"transport": "tmux", "tmux_pane": "%3", "tmux_socket": "/tmp/tmux-501/default", "text": "x", "submit": True}
    )
    assert status == "sent"
    assert calls[0][:2] == ["tmux", "-S"]
    assert "load-buffer" in calls[0]
    assert "paste-buffer" in calls[1] and "-p" in calls[1]  # bracketed paste
    assert calls[2][-2:] == ["-t", "%3"] or "Enter" in calls[2]


async def test_deliver_unknown_transport():
    from cue_runner import deliver

    status, err = await deliver.deliver_one({"transport": "carrier-pigeon"})
    assert status == "failed" and "unknown transport" in err


async def test_deliver_strips_bracketed_paste_terminator(monkeypatch):
    """Prompt text can't smuggle an ESC[201~ terminator into the paste stream."""
    from cue_runner import deliver

    calls = []

    async def fake_run(argv, stdin=None):
        calls.append({"argv": argv, "stdin": stdin})
        return 0, "ok"

    monkeypatch.setattr(deliver, "_run", fake_run)
    evil = "before\x1b[201~echo pwned\nafter"
    st, err = await deliver.deliver_one(
        {"transport": "iterm", "iterm_session_id": "w0:ABCDEF0123", "text": evil, "submit": False}
    )
    assert st == "sent"
    passed_text = calls[0]["argv"][3]  # osascript - <guid> <text> <submit>
    assert "\x1b" not in passed_text  # ESC stripped
    assert "201~echo pwned" in passed_text  # rest kept as literal (no ESC prefix)
    assert "\n" in passed_text  # newline preserved (multi-line prompts still work)


async def test_run_times_out(monkeypatch):
    """A hanging subprocess is killed and reported, not left to wedge the loop."""
    from cue_runner import deliver

    monkeypatch.setattr(deliver, "_RUN_TIMEOUT", 0.05)

    class HangProc:
        returncode = None

        async def communicate(self, input=None):
            await asyncio.sleep(10)

        def kill(self):
            self.returncode = -9

        async def wait(self):
            return -9

    async def fake_exec(*a, **k):
        return HangProc()

    monkeypatch.setattr(deliver.asyncio, "create_subprocess_exec", fake_exec)
    code, out = await deliver._run(["osascript", "-"], stdin=b"x")
    assert code == 124 and "timed out" in out


# ---- config (Config.from_env) ----
def test_config_from_env_full_parse(monkeypatch):
    env = {
        "CUE_API_URL": "https://cue.example/",  # trailing slash stripped
        "RUNNER_TOKEN": "tok",
        "ALLOWED_BASES": " /a/one , /b/two/ ",  # trimmed + normalized
        "CLAUDE_PATH": "/opt/claude",
        "RUNNER_ID": "mac-2",
        "POLL_INTERVAL": "2.5",
        "MAX_CONCURRENCY": "3",
        "HEARTBEAT_INTERVAL": "7",
        "RUN_TIMEOUT": "60",
        "CAPTURE_TOKEN": "cap",
        "CAPTURE_INTERVAL": "1.5",
        "CUE_DELIVER": "0",
        "DELIVER_INTERVAL": "9",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    cfg = Config.from_env()
    assert cfg.api_url == "https://cue.example"
    assert cfg.allowed_bases == ["/a/one", "/b/two"]
    assert cfg.poll_interval == 2.5 and cfg.max_concurrency == 3
    assert cfg.heartbeat_interval == 7.0 and cfg.run_timeout == 60.0
    assert cfg.deliver_enabled is False  # "0" disables the delivery loop
    assert cfg.deliver_interval == 9.0
    assert cfg.claude_path == "/opt/claude" and cfg.runner_id == "mac-2"

    monkeypatch.setenv("CUE_DELIVER", "false")
    assert Config.from_env().deliver_enabled is False
    monkeypatch.delenv("CUE_DELIVER")
    assert Config.from_env().deliver_enabled is True  # default on


def test_config_from_env_missing_required(monkeypatch):
    import pytest

    for var in ("CUE_API_URL", "RUNNER_TOKEN", "ALLOWED_BASES"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("CUE_API_URL", "https://cue.example")
    with pytest.raises(RuntimeError) as exc:
        Config.from_env()
    msg = str(exc.value)
    assert "RUNNER_TOKEN" in msg and "ALLOWED_BASES" in msg
    assert "CUE_API_URL" not in msg  # the one that IS set isn't reported


# ---- paths ----
def test_path_whitelist_edge_cases():
    assert not is_path_allowed("/x", [])  # no bases -> closed
    assert not is_path_allowed("", ["/x"])
    assert not is_path_allowed("/x/a\x00b", ["/x"])
    # Bases are normalized, so a configured trailing slash still matches.
    assert is_path_allowed("/x/sub", ["/x/"])


# ---- stream summaries ----
def test_stream_summarize_variants():
    tool = parse_line(json.dumps({
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": "Bash"},
                                {"type": "text", "text": "running"}]},
    }))
    assert summarize(tool) == ("assistant", "[tool: Bash] running")
    assert summarize({"type": "user"}) == ("user", "[tool result]")
    assert summarize({"type": "system", "subtype": "init"}) == ("system:init", "init")
    assert summarize({"type": "system"}) == ("system", "")
    # Non-dict JSON and blank lines parse to None.
    assert parse_line("[1, 2, 3]") is None
    assert parse_line('"just a string"') is None
    assert parse_line("   ") is None


def test_stream_summarize_truncates_long_output():
    huge = parse_line(json.dumps({"type": "result", "result": "x" * 10_000}))
    label, line = summarize(huge)
    assert label == "result" and len(line) == 4000


# ---- executor edge cases ----
async def test_execute_step_timeout_kills_subprocess():
    cfg = _cfg()
    cfg.run_timeout = 0.1
    proc = FakeProc(["{}\n"], hang=True)  # stdout never reaches EOF
    api = FakeApi()
    run = {"id": "r-t", "project_path": "/Users/martin/claude/cue"}
    out = await execute_step(cfg, api, run, 0, "hi", "sess", asyncio.Event(),
                             spawn=_spawn_factory(proc))
    assert out.status == "failed"  # timeout reports failed, not canceled
    assert proc.terminated or proc.killed  # no orphaned subprocess


async def test_execute_step_reports_stream_read_error():
    class BrokenStdout:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise ValueError("Separator is not found, and chunk exceed the limit")

    proc = FakeProc([])
    proc.stdout = BrokenStdout()
    api = FakeApi()
    run = {"id": "r-e", "project_path": "/Users/martin/claude/cue"}
    out = await execute_step(_cfg(), api, run, 0, "hi", "sess", asyncio.Event(),
                             spawn=_spawn_factory(proc))
    assert out.status == "failed"
    # The error surfaced in the run log instead of being swallowed.
    assert any("stream read error" in line for _idx, batch in api.logs for _e, line in batch)


async def test_execute_step_nonzero_exit_without_result_event():
    proc = FakeProc([json.dumps({"type": "system", "subtype": "init", "session_id": "s1"}) + "\n"])
    proc.returncode = 3

    async def wait():
        return 3

    proc.wait = wait
    api = FakeApi()
    run = {"id": "r-x", "project_path": "/Users/martin/claude/cue"}
    out = await execute_step(_cfg(), api, run, 0, "hi", "sess", asyncio.Event(),
                             spawn=_spawn_factory(proc))
    assert out.status == "failed" and out.exit_code == 3


async def test_execute_run_continue_on_error(monkeypatch, tmp_path):
    """stop_on_error=False keeps executing after a failed step; the run still fails."""
    cfg = _cfg(bases=[str(tmp_path)])
    api = FakeApi()
    run = {
        "id": "r-c",
        "project_path": str(tmp_path),
        "stop_on_error": False,
        "steps": [{"step_index": 0, "prompt_text": "a"}, {"step_index": 1, "prompt_text": "b"}],
    }
    outcomes = iter([
        executor.StepOutcome(status="failed", exit_code=1, session_id="s"),
        executor.StepOutcome(status="succeeded", session_id="s", cost=0.5),
    ])

    async def fake_step(*a, **k):
        return next(outcomes)

    monkeypatch.setattr(executor, "execute_step", fake_step)
    await execute_run(cfg, api, run, asyncio.Event())
    statuses = {idx: status for idx, status, _ in api.steps}
    assert statuses == {0: "failed", 1: "succeeded"}  # step 1 still ran
    assert api.runs[-1][0] == "failed"
    assert api.runs[-1][1]["total_cost_usd"] == 0.5


async def test_execute_run_symlink_escape_rejected(tmp_path):
    """A symlink inside an allowed base must not smuggle the run elsewhere."""
    import os as _os

    base = tmp_path / "base"
    outside = tmp_path / "outside"
    base.mkdir()
    outside.mkdir()
    link = base / "sneaky"
    _os.symlink(outside, link)

    cfg = _cfg(bases=[str(base)])
    api = FakeApi()
    run = {"id": "r-s", "project_path": str(link),
           "steps": [{"step_index": 0, "prompt_text": "x"}]}
    await execute_run(cfg, api, run, asyncio.Event())
    assert api.runs[-1][0] == "failed"
    assert "escapes" in api.runs[-1][1]["error"]
    assert not api.steps  # never executed


async def test_execute_run_pre_canceled_skips_all_steps(tmp_path):
    cfg = _cfg(bases=[str(tmp_path)])
    api = FakeApi()
    cancel = asyncio.Event()
    cancel.set()
    run = {"id": "r-pc", "project_path": str(tmp_path),
           "steps": [{"step_index": 0, "prompt_text": "a"},
                     {"step_index": 1, "prompt_text": "b"}]}
    await execute_run(cfg, api, run, cancel)
    assert [s for _i, s, _k in api.steps] == ["canceled", "canceled"]
    assert api.runs[-1][0] == "canceled"


def test_child_env_strips_runner_secrets(monkeypatch):
    monkeypatch.setenv("RUNNER_TOKEN", "runner-secret")
    monkeypatch.setenv("CAPTURE_TOKEN", "capture-secret")
    monkeypatch.setenv("CUE_API_URL", "https://cue.example")
    monkeypatch.setenv("HARMLESS", "keep-me")
    env = executor._child_env()
    assert "RUNNER_TOKEN" not in env
    assert "CAPTURE_TOKEN" not in env
    assert "CUE_API_URL" not in env  # all CUE_* config is withheld
    assert env["HARMLESS"] == "keep-me"
    assert env["CUE_NO_CAPTURE"] == "1"  # the runner's claude runs aren't re-captured


# ---- daemon loops (runner.py) ----
async def test_heartbeat_loop_propagates_cancel():
    """cancel_requested from cue reaches the executor's cancel event."""
    from cue_runner import runner

    class HbApi:
        def __init__(self):
            self.calls = 0

        async def heartbeat(self, run_id):
            self.calls += 1
            return {"status": "running", "cancel_requested": self.calls >= 2}

    cfg = _cfg()
    cfg.heartbeat_interval = 0.01
    api = HbApi()
    cancel = asyncio.Event()
    stop = asyncio.Event()
    task = asyncio.create_task(runner._heartbeat_loop(cfg, api, "r1", cancel, stop))
    await asyncio.wait_for(cancel.wait(), timeout=2)
    stop.set()
    await asyncio.wait_for(task, timeout=2)
    assert api.calls >= 2


async def test_heartbeat_loop_survives_api_errors():
    from cue_runner import runner

    class FlakyApi:
        def __init__(self):
            self.calls = 0

        async def heartbeat(self, run_id):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("cue briefly unreachable")
            return {"status": "canceled", "cancel_requested": False}

    cfg = _cfg()
    cfg.heartbeat_interval = 0.01
    api = FlakyApi()
    cancel = asyncio.Event()
    stop = asyncio.Event()
    task = asyncio.create_task(runner._heartbeat_loop(cfg, api, "r1", cancel, stop))
    # A server-side 'canceled' status also sets the cancel event.
    await asyncio.wait_for(cancel.wait(), timeout=2)
    stop.set()
    await asyncio.wait_for(task, timeout=2)


async def test_delivery_loop_always_resolves_claimed_deliveries(monkeypatch):
    """Even when the transport crashes, the claimed delivery is reported failed
    (otherwise it would sit in 'sending' until the stale reaper)."""
    from cue_runner import runner

    class DeliveryApi:
        def __init__(self):
            self.claims = [{"id": 7, "transport": "iterm"}]
            self.results = []

        async def claim_delivery(self):
            return self.claims.pop() if self.claims else None

        async def delivery_result(self, did, status, error=None):
            self.results.append((did, status, error))

    async def exploding_deliver(d):
        raise RuntimeError("osascript blew up")

    monkeypatch.setattr(runner, "deliver_one", exploding_deliver)
    cfg = _cfg()
    cfg.deliver_interval = 0.01
    api = DeliveryApi()
    stop = asyncio.Event()
    task = asyncio.create_task(runner._delivery_loop(cfg, api, stop))
    for _ in range(200):
        if api.results:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, timeout=2)
    assert api.results == [(7, "failed", "runner error: osascript blew up")]


async def test_handle_run_reports_crash_and_releases_slot(monkeypatch):
    from cue_runner import runner

    class CrashApi:
        def __init__(self):
            self.results = []

        async def heartbeat(self, run_id):
            return {"status": "running", "cancel_requested": False}

        async def run_result(self, run_id, status, **kw):
            self.results.append((run_id, status, kw))

    async def broken_execute(cfg, api, run, cancel_event):
        raise RuntimeError("unexpected bug")

    monkeypatch.setattr(runner, "execute_run", broken_execute)
    cfg = _cfg()
    api = CrashApi()
    sem = asyncio.Semaphore(1)
    await sem.acquire()  # the claim loop acquires before spawning _handle_run
    active: set[asyncio.Event] = set()
    await asyncio.wait_for(
        runner._handle_run(cfg, api, {"id": "r9", "steps": []}, sem, active), timeout=2
    )
    assert api.results[0][1] == "failed"
    assert "runner error" in api.results[0][2]["error"]
    assert not sem.locked()  # concurrency slot released for the next run
    assert active == set()  # cancel bookkeeping cleaned up


@pytest.mark.asyncio
async def test_deliver_iterm_reports_osascript_failure(monkeypatch):
    from cue_runner import deliver

    async def failing_run(argv, stdin=None):
        return 1, "execution error: not authorised"

    monkeypatch.setattr(deliver, "_run", failing_run)
    status, error = await deliver._deliver_iterm(
        {"iterm_session_id": "w0t0p0:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", "text": "hi"}
    )
    assert status == "failed" and "not authorised" in error


@pytest.mark.asyncio
async def test_deliver_tmux_rejects_dash_socket():
    from cue_runner import deliver

    status, error = await deliver._deliver_tmux(
        {"tmux_pane": "%1", "tmux_socket": "--evil", "text": "hi"}
    )
    assert status == "failed" and "socket" in error


@pytest.mark.asyncio
async def test_deliver_tmux_reports_each_stage_failure(monkeypatch):
    from cue_runner import deliver

    # Fail at load-buffer, then paste-buffer, then send-keys — each surfaces.
    for fail_on, expected in (
        ("load-buffer", "load-buffer"),
        ("paste-buffer", "paste-buffer"),
        ("send-keys", "send-keys"),
    ):
        async def staged_run(argv, stdin=None, _fail=fail_on):
            return (1, f"tmux {_fail} failed") if _fail in argv else (0, "")

        monkeypatch.setattr(deliver, "_run", staged_run)
        status, error = await deliver._deliver_tmux(
            {"tmux_pane": "%1", "tmux_socket": "", "text": "hi", "submit": True}
        )
        assert status == "failed" and expected in error
