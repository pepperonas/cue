"""Runner unit tests — subprocess + HTTP are faked."""
from __future__ import annotations

import asyncio
import json

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
