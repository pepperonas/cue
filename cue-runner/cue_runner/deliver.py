"""Type a prompt from the web app into a live terminal session.

There is no official "inject into a running interactive CLI" API, so we drive
the terminal directly. Two transports: iTerm2 (AppleScript `write text`) and
tmux (`paste-buffer`). Both send the text via **bracketed paste** so multi-line
prompts land as literal input in the CLI's editor instead of submitting at every
newline; the optional Enter to submit is a separate keystroke.

All process arguments go through argv (no shell), and ids are validated, so a
compromised server can't inject shell/AppleScript or extra flags.
"""
from __future__ import annotations

import asyncio
import contextlib
import re

# Each osascript/tmux call must not wedge the (serial) delivery loop — the very
# first iTerm delivery can block on the macOS Automation-permission dialog.
_RUN_TIMEOUT = 20.0

# Strip ESC + other C0 control bytes (keep \t and \n) from delivered text so a
# prompt can't embed a bracketed-paste terminator (ESC[201~) — which would end
# paste mode early and let the remainder run as live keystrokes/commands.
_CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _sanitize_text(text: str) -> str:
    return _CTRL_RE.sub("", text or "")

# iTerm2: find the session whose id matches the GUID, bracketed-paste the text,
# then optionally send a bare return to submit. Text/guid/submit come via argv
# (item 1..3 of `on run argv`), never interpolated into the script source.
_ITERM_SCRIPT = r'''
on run argv
  set sid to item 1 of argv
  set theText to item 2 of argv
  set doSubmit to (item 3 of argv) is "1"
  set ESC to (character id 27)
  set payload to ESC & "[200~" & theText & ESC & "[201~"
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) is sid then
            tell s to write text payload newline false
            if doSubmit then tell s to write text "" newline true
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "iTerm session not found"
end run
'''

_GUID_RE = re.compile(r"^[0-9A-Fa-f-]{8,}$")
_PANE_RE = re.compile(r"^[%A-Za-z0-9_.:-]+$")


async def _run(argv: list[str], stdin: bytes | None = None) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(input=stdin), timeout=_RUN_TIMEOUT)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()
        return 124, "timed out (terminal unresponsive or awaiting Automation permission?)"
    return proc.returncode or 0, out.decode("utf-8", "replace").strip()


async def _deliver_iterm(d: dict) -> tuple[str, str | None]:
    raw = (d.get("iterm_session_id") or "").strip()
    guid = raw.rsplit(":", 1)[-1]  # ITERM_SESSION_ID is "wNtMpK:GUID"
    if not _GUID_RE.match(guid):
        return "failed", "invalid iTerm session id"
    code, out = await _run(
        ["osascript", "-", guid, d.get("text", ""), "1" if d.get("submit") else "0"],
        stdin=_ITERM_SCRIPT.encode("utf-8"),
    )
    if code != 0:
        return "failed", (out or "osascript failed")[:400]
    return "sent", None


async def _deliver_tmux(d: dict) -> tuple[str, str | None]:
    pane = (d.get("tmux_pane") or "").strip()
    socket = (d.get("tmux_socket") or "").strip()
    if not _PANE_RE.match(pane) or pane.startswith("-"):
        return "failed", "invalid tmux pane"
    base = ["tmux"]
    if socket:
        if socket.startswith("-"):
            return "failed", "invalid tmux socket"
        base += ["-S", socket]
    # Load the text into a named buffer, then bracketed-paste it into the pane.
    code, out = await _run(base + ["load-buffer", "-b", "cue-send", "-"], stdin=d.get("text", "").encode("utf-8"))
    if code != 0:
        return "failed", (out or "tmux load-buffer failed")[:400]
    code, out = await _run(base + ["paste-buffer", "-p", "-d", "-b", "cue-send", "-t", pane])
    if code != 0:
        return "failed", (out or "tmux paste-buffer failed")[:400]
    if d.get("submit"):
        code, out = await _run(base + ["send-keys", "-t", pane, "Enter"])
        if code != 0:
            return "failed", (out or "tmux send-keys failed")[:400]
    return "sent", None


async def deliver_one(d: dict) -> tuple[str, str | None]:
    """Perform one delivery. Returns (status, error) — status is 'sent'|'failed'."""
    d = {**d, "text": _sanitize_text(d.get("text", ""))}
    transport = d.get("transport")
    if transport == "iterm":
        return await _deliver_iterm(d)
    if transport == "tmux":
        return await _deliver_tmux(d)
    return "failed", f"unknown transport: {transport}"
