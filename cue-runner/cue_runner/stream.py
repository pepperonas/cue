"""Parse the Claude Code `stream-json` event stream (verified vs CLI v2.1.195).

Every event carries `session_id`. `system` events have a `subtype` (incl.
`init`). The terminal `result` event carries `is_error`, `total_cost_usd`,
`num_turns`, and `result` (final assistant text).
"""
from __future__ import annotations

import json

_MAX_LINE = 4000


def parse_line(line: str) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def is_result(event: dict) -> bool:
    return event.get("type") == "result"


def session_id_of(event: dict) -> str | None:
    sid = event.get("session_id")
    return sid if isinstance(sid, str) and sid else None


def summarize(event: dict) -> tuple[str, str]:
    """(event_type, short human line) for the live log tail."""
    etype = event.get("type", "?")
    subtype = event.get("subtype")
    label = f"{etype}:{subtype}" if subtype else etype
    line = ""
    if etype == "assistant":
        parts: list[str] = []
        for block in ((event.get("message") or {}).get("content") or []):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                parts.append(f"[tool: {block.get('name')}]")
        line = " ".join(p for p in parts if p).strip()
    elif etype == "result":
        line = str(event.get("result", ""))
    elif etype == "system":
        line = subtype or ""
    elif etype == "user":
        line = "[tool result]"
    return label, line[:_MAX_LINE]
