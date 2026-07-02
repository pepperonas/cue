"""Runner configuration, loaded from the environment."""
from __future__ import annotations

import os
import posixpath
from dataclasses import dataclass


def _bases(value: str | None) -> list[str]:
    return [posixpath.normpath(p.strip()) for p in (value or "").split(",") if p.strip()]


@dataclass
class Config:
    api_url: str
    runner_token: str
    allowed_bases: list[str]
    claude_path: str = "claude"
    runner_id: str = "mac-runner"
    poll_interval: float = 5.0
    max_concurrency: int = 1
    heartbeat_interval: float = 15.0
    run_timeout: float = 1800.0
    # Prompt capture forwarder (disabled when capture_token is empty).
    capture_token: str = ""
    spool_path: str = ""
    capture_state_path: str = ""
    capture_interval: float = 2.0
    # CLI delivery: type prompts from the web app back into a live session.
    deliver_enabled: bool = True
    deliver_interval: float = 1.5

    @classmethod
    def from_env(cls) -> "Config":
        api_url = os.environ.get("CUE_API_URL", "").rstrip("/")
        token = os.environ.get("RUNNER_TOKEN", "")
        bases = _bases(os.environ.get("ALLOWED_BASES", ""))
        missing = [
            name
            for name, val in (("CUE_API_URL", api_url), ("RUNNER_TOKEN", token), ("ALLOWED_BASES", bases))
            if not val
        ]
        if missing:
            raise RuntimeError(f"Missing required config: {', '.join(missing)}")
        return cls(
            api_url=api_url,
            runner_token=token,
            allowed_bases=bases,
            claude_path=os.environ.get("CLAUDE_PATH", "claude"),
            runner_id=os.environ.get("RUNNER_ID", "mac-runner"),
            poll_interval=float(os.environ.get("POLL_INTERVAL", "5")),
            max_concurrency=int(os.environ.get("MAX_CONCURRENCY", "1")),
            heartbeat_interval=float(os.environ.get("HEARTBEAT_INTERVAL", "15")),
            run_timeout=float(os.environ.get("RUN_TIMEOUT", "1800")),
            capture_token=os.environ.get("CAPTURE_TOKEN", ""),
            spool_path=os.path.expanduser(
                os.environ.get("CUE_CAPTURE_SPOOL", "~/.cue-runner/capture-spool.jsonl")
            ),
            capture_state_path=os.path.expanduser(
                os.environ.get("CUE_CAPTURE_STATE", "~/.cue-runner/capture-state.json")
            ),
            capture_interval=float(os.environ.get("CAPTURE_INTERVAL", "2")),
            deliver_enabled=os.environ.get("CUE_DELIVER", "1") not in ("0", "false", "no"),
            deliver_interval=float(os.environ.get("DELIVER_INTERVAL", "1.5")),
        )
