#!/usr/bin/env python3
"""Claude Code UserPromptSubmit hook: append the submitted prompt to a local
spool that the cue-runner forwards to cue. Fire-and-forget — never blocks or
fails the prompt (always exits 0). Skips when CUE_NO_CAPTURE is set (the
cue-runner sets it on its own headless claude runs to avoid a capture loop)."""
import json
import os
import sys
import time


def main() -> None:
    if os.environ.get("CUE_NO_CAPTURE"):
        return
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return
    spool = os.environ.get("CUE_CAPTURE_SPOOL") or os.path.expanduser(
        "~/.cue-runner/capture-spool.jsonl"
    )
    try:
        os.makedirs(os.path.dirname(spool), exist_ok=True)
        # tmux env is "socket,pid,session" — the socket is the first field.
        tmux = os.environ.get("TMUX", "")
        line = json.dumps(
            {
                "session_id": data.get("session_id", ""),
                "cwd": data.get("cwd", ""),
                "prompt": prompt,
                "ts": time.time(),
                # Live terminal context so cue can send prompts back here.
                "term_program": os.environ.get("TERM_PROGRAM", ""),
                "iterm_session_id": os.environ.get("ITERM_SESSION_ID", ""),
                "tmux_pane": os.environ.get("TMUX_PANE", ""),
                "tmux_socket": tmux.split(",")[0] if tmux else "",
            },
            ensure_ascii=False,
        )
        with open(spool, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    finally:
        sys.exit(0)
