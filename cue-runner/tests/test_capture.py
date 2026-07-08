"""Tests for the prompt-capture forwarder + hook script."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from cue_runner.capture import CaptureForwarder, plan_items
from cue_runner.config import Config

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "capture_hook.py"


def _cfg(tmp_path) -> Config:
    return Config(
        api_url="http://x",
        runner_token="t",
        allowed_bases=["/Users/martin/claude"],
        capture_token="cap",
        spool_path=str(tmp_path / "spool.jsonl"),
        capture_state_path=str(tmp_path / "state.json"),
    )


def _line(sid, prompt, cwd="/Users/martin/claude/cue"):
    return json.dumps({"session_id": sid, "cwd": cwd, "prompt": prompt, "ts": 1.0}) + "\n"


def test_plan_items_seq_per_session():
    text = _line("A", "a1") + _line("B", "b1") + _line("A", "a2")
    items, seqs, consumed = plan_items(text, {})
    assert [(i["session_id"], i["seq"], i["prompt"]) for i in items] == [
        ("A", 1, "a1"),
        ("B", 1, "b1"),
        ("A", 2, "a2"),
    ]
    assert seqs == {"A": 2, "B": 1}
    assert consumed == len(text.encode())


def test_plan_items_forwards_git_root():
    rec = {"session_id": "A", "cwd": "/x/_customers/celox/website", "prompt": "p",
           "git_root": "/x/_customers/celox/website", "ts": 1.0}
    items, _s, _c = plan_items(json.dumps(rec) + "\n", {})
    assert items[0]["git_root"] == "/x/_customers/celox/website"
    # Old spool lines without git_root still parse (empty string forwarded).
    items2, _s2, _c2 = plan_items(_line("B", "b1"), {})
    assert items2[0]["git_root"] == ""


def test_plan_items_ignores_partial_trailing_line():
    text = _line("A", "a1") + '{"session_id":"A","prompt":"partial"'  # no newline
    items, _seqs, consumed = plan_items(text, {})
    assert [i["prompt"] for i in items] == ["a1"]
    assert consumed == len(_line("A", "a1").encode())  # partial left for next read


def test_plan_items_deterministic_after_state_loss():
    text = _line("A", "a1") + _line("A", "a2") + _line("B", "b1")
    first, _s, _c = plan_items(text, {})
    # Re-processing from empty seqs (state lost) reproduces identical (session, seq).
    again, _s2, _c2 = plan_items(text, {})
    assert first == again


class FakeApi:
    def __init__(self):
        self.batches: list[list[dict]] = []

    async def capture(self, items):
        self.batches.append(items)
        return {"stored": len(items), "skipped": 0}


async def test_forwarder_step_and_resume(tmp_path):
    cfg = _cfg(tmp_path)
    Path(cfg.spool_path).write_text(_line("A", "a1") + _line("A", "a2"))
    api = FakeApi()
    fwd = CaptureForwarder(cfg, api)

    assert await fwd.step() == 2
    assert [i["seq"] for i in api.batches[0]] == [1, 2]
    assert await fwd.step() == 0  # nothing new

    # Append one more -> only the new line is forwarded, seq continues.
    with open(cfg.spool_path, "a") as f:
        f.write(_line("A", "a3"))
    assert await fwd.step() == 1
    assert api.batches[-1][0]["seq"] == 3

    # State persisted (offset + seqs).
    state = json.loads(Path(cfg.capture_state_path).read_text())
    assert state["seqs"]["A"] == 3


def test_hook_writes_spool(tmp_path):
    spool = tmp_path / "spool.jsonl"
    payload = json.dumps(
        {"session_id": "S1", "cwd": "/Users/martin/claude/cue", "prompt": "hello"}
    )
    subprocess.run(
        [sys.executable, str(HOOK)],
        input=payload,
        text=True,
        env={"CUE_CAPTURE_SPOOL": str(spool), "PATH": "/usr/bin:/bin"},
        check=True,
    )
    rec = json.loads(spool.read_text().strip())
    assert rec["session_id"] == "S1" and rec["prompt"] == "hello"


def test_hook_records_git_root(tmp_path):
    """The hook walks up from cwd to the nearest .git and spools it, so cue can
    name projects by repo root (splits grouping dirs like _customers)."""
    repo = tmp_path / "_customers" / "celox" / "website"
    (repo / ".git").mkdir(parents=True)
    cwd = repo / "src"
    cwd.mkdir()
    spool = tmp_path / "spool.jsonl"
    subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"session_id": "S2", "cwd": str(cwd), "prompt": "hi"}),
        text=True,
        env={"CUE_CAPTURE_SPOOL": str(spool), "PATH": "/usr/bin:/bin"},
        check=True,
    )
    rec = json.loads(spool.read_text().strip())
    assert rec["git_root"] == str(repo)


def test_hook_skips_when_no_capture(tmp_path):
    spool = tmp_path / "spool.jsonl"
    subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"session_id": "S", "prompt": "x"}),
        text=True,
        env={"CUE_CAPTURE_SPOOL": str(spool), "CUE_NO_CAPTURE": "1", "PATH": "/usr/bin:/bin"},
        check=True,
    )
    assert not spool.exists()
