"""Application configuration loaded from environment variables.

Single-user app: there is no user table, just one password hash in the env.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """Runtime settings. Read once and cached."""

    def __init__(self) -> None:
        # Secret used to sign session + CSRF tokens (itsdangerous).
        self.secret_key: str = os.environ.get("SECRET_KEY", "")

        # Argon2id hash of the single login password (see scripts/gen_password_hash.py).
        self.app_password_hash: str = os.environ.get("APP_PASSWORD_HASH", "")

        # Session lifetime in seconds. Default 30 days ("remember me").
        self.session_max_age: int = int(os.environ.get("SESSION_MAX_AGE", str(30 * 24 * 3600)))

        # Cookie flags. COOKIE_SECURE must be true behind the TLS-terminating proxy.
        self.cookie_secure: bool = _bool(os.environ.get("COOKIE_SECURE"), default=True)

        # Allowed browser origin, used for CSP/connect-src and a strict Origin check.
        self.allowed_origin: str = os.environ.get("ALLOWED_ORIGIN", "https://cue.celox.io")

        # Whether to trust the X-Forwarded-For header for the client IP. Only
        # enable when a trusted reverse proxy sets it (it does on the VPS). When
        # false, the socket peer is used so XFF cannot be spoofed to dodge the
        # login rate limit.
        self.trust_proxy: bool = _bool(os.environ.get("TRUST_PROXY"), default=True)

        # SQLite database file. Lives on a persistent volume in production.
        self.db_path: str = os.environ.get("DB_PATH", str(Path("data") / "cue.db"))

        # Directory for uploaded .txt imports (transient working files).
        self.upload_dir: str = os.environ.get("UPLOAD_DIR", str(Path("data") / "uploads"))

        # Directory holding the built frontend (StaticFiles). Optional in dev.
        self.static_dir: str = os.environ.get("STATIC_DIR", str(Path("static")))

        # When true, copying a prompt flips queued -> running by default on the
        # client; this is purely a client preference but mirrored here for docs.
        self.dev_mode: bool = _bool(os.environ.get("CUE_DEV"), default=False)

    @property
    def cookie_name(self) -> str:
        return "cue_session"

    @property
    def csrf_cookie_name(self) -> str:
        return "cue_csrf"

    def ensure_dirs(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)

    def validate(self) -> None:
        """Fail fast on misconfiguration in production-ish setups."""
        problems: list[str] = []
        if not self.secret_key:
            problems.append("SECRET_KEY is not set")
        if not self.app_password_hash:
            problems.append("APP_PASSWORD_HASH is not set")
        if problems and not self.dev_mode:
            raise RuntimeError(
                "Invalid configuration: "
                + "; ".join(problems)
                + ". Set them in .env (see .env.example) or export CUE_DEV=1 for local dev."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate()
    return settings
