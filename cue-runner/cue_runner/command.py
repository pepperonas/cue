"""Build the `claude` argv for a step (no shell, no string interpolation).

CLI v2.1.195 notes: there is no `--cwd` (the runner sets the subprocess cwd) and
no `--max-turns`. Chains thread one session via a pre-assigned `--session-id` on
step 0 and `--resume` thereafter.
"""
from __future__ import annotations

import re

from .config import Config


def _split_tools(value: str) -> list[str]:
    # Drop any token that could be read as a CLI flag ("-"/"--…"): a compromised
    # server must not be able to smuggle extra `claude` flags via allowed_tools.
    return [t for t in re.split(r"[,\s]+", value.strip()) if t and not t.startswith("-")]


def build_command(
    cfg: Config, run: dict, step_index: int, prompt: str, session_id: str
) -> list[str]:
    argv = [cfg.claude_path, "-p", prompt, "--output-format", "stream-json", "--verbose"]
    if step_index == 0:
        argv += ["--session-id", session_id]
    else:
        argv += ["--resume", session_id]
    if run.get("model"):
        argv += ["--model", run["model"]]
    if run.get("allowed_tools"):
        tools = _split_tools(run["allowed_tools"])
        if tools:
            argv += ["--allowedTools", *tools]
    if run.get("permission_mode"):
        argv += ["--permission-mode", run["permission_mode"]]
    if run.get("bare"):
        argv += ["--bare"]
    if run.get("skip_permissions"):
        argv += ["--dangerously-skip-permissions"]
    return argv
