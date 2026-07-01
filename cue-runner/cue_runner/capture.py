"""Forward captured prompts (written to a spool by the UserPromptSubmit hook)
to cue. The spool is append-only; seq is derived per session by counting in
order, so re-reading after a state loss reproduces identical (session, seq)
pairs — cue dedups them, giving at-least-once delivery without duplicates."""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger("cue-runner.capture")

_MAX_BATCH = 200


def plan_items(
    data: str, seqs: dict[str, int]
) -> tuple[list[dict], dict[str, int], int]:
    """Turn newly-read spool text into capture items.

    Only whole lines (up to the last newline) are consumed, so a half-written
    trailing line is left for next time. Returns (items, updated_seqs,
    consumed_char_count). `seqs` is mutated-copy per session.
    """
    cut = data.rfind("\n")
    if cut < 0:
        return [], seqs, 0
    complete = data[: cut + 1]
    seqs = dict(seqs)
    items: list[dict] = []
    for raw in complete.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        sid = rec.get("session_id") or ""
        prompt = (rec.get("prompt") or "").strip()
        if not sid or not prompt:
            continue
        seqs[sid] = seqs.get(sid, 0) + 1
        items.append(
            {
                "session_id": sid,
                "cwd": rec.get("cwd", ""),
                "prompt": prompt,
                "seq": seqs[sid],
                "ts": rec.get("ts"),
            }
        )
    return items, seqs, len(complete.encode("utf-8"))


class CaptureForwarder:
    def __init__(self, cfg, api) -> None:
        self.cfg = cfg
        self.api = api
        self.offset = 0
        self.seqs: dict[str, int] = {}
        self._load_state()

    def _load_state(self) -> None:
        try:
            with open(self.cfg.capture_state_path, encoding="utf-8") as f:
                state = json.load(f)
            self.offset = int(state.get("offset", 0))
            self.seqs = {str(k): int(v) for k, v in (state.get("seqs") or {}).items()}
        except (OSError, ValueError):
            self.offset, self.seqs = 0, {}

    def _save_state(self) -> None:
        path = self.cfg.capture_state_path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"offset": self.offset, "seqs": self.seqs}, f)
        os.replace(tmp, path)

    async def step(self) -> int:
        """Forward any new complete spool lines. Returns the number stored."""
        spool = self.cfg.spool_path
        try:
            size = os.path.getsize(spool)
        except OSError:
            return 0
        if size <= self.offset:
            if size < self.offset:  # spool was truncated/rotated -> restart
                self.offset, self.seqs = 0, {}
            return 0
        with open(spool, "rb") as f:
            f.seek(self.offset)
            data = f.read().decode("utf-8", "replace")
        items, seqs, consumed = plan_items(data, self.seqs)
        if not items:
            return 0
        stored = 0
        for i in range(0, len(items), _MAX_BATCH):
            batch = items[i : i + _MAX_BATCH]
            res = await self.api.capture(batch)  # raises on failure -> retried next tick
            stored += int(res.get("stored", 0))
        # Commit only after a successful POST of the whole read.
        self.offset += consumed
        self.seqs = seqs
        self._save_state()
        return stored
