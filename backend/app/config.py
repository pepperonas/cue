"""Application configuration loaded from environment variables.

Multi-tenant app: users sign in with Google; each user owns their own projects
and prompts. Access is gated by an allowlist of emails/domains.
"""
from __future__ import annotations

import os
import posixpath
from functools import lru_cache
from pathlib import Path


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv_set(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip().lower() for part in value.split(",") if part.strip()}


class Settings:
    """Runtime settings. Read once and cached."""

    def __init__(self) -> None:
        # Secret used to sign session + CSRF + OAuth-state tokens (itsdangerous).
        self.secret_key: str = os.environ.get("SECRET_KEY", "")

        # Google OAuth 2.0 (Authorization Code flow). The secret stays server-side.
        self.google_client_id: str = os.environ.get("GOOGLE_CLIENT_ID", "")
        self.google_client_secret: str = os.environ.get("GOOGLE_CLIENT_SECRET", "")

        # Access allowlist. Empty + empty = closed (nobody) in prod; a user may
        # sign in if their email is listed OR their domain is listed.
        self.allowed_emails: set[str] = _csv_set(os.environ.get("GOOGLE_ALLOWED_EMAILS"))
        self.allowed_domains: set[str] = _csv_set(os.environ.get("GOOGLE_ALLOWED_DOMAINS"))

        # On this user's first login, claim any pre-multi-tenant (user_id IS NULL)
        # projects/prompts. Lets the original single-user data carry over.
        self.owner_email: str = os.environ.get("OWNER_EMAIL", "").strip().lower()

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

        # Directory for persisted prompt image attachments (screenshots).
        self.attachments_dir: str = os.environ.get(
            "ATTACHMENTS_DIR", str(Path("data") / "attachments")
        )
        # Per-file upload cap for attachments (bytes). Default 10 MB.
        self.max_attachment_bytes: int = int(
            os.environ.get("MAX_ATTACHMENT_BYTES", str(10 * 1024 * 1024))
        )

        # ---- Run engine (Claude Code CLI runner) ----
        # Shared secret the Mac runner presents (Authorization: Bearer ...).
        self.runner_token: str = os.environ.get("RUNNER_TOKEN", "")
        # Allowed project base paths (absolute, on the runner's machine). A run's
        # project_path must equal or sit under one of these. Validated as strings
        # here (the VPS has no access to the runner's filesystem); the runner
        # re-validates against its own ALLOWED_BASES.
        self.allowed_project_bases: list[str] = [
            posixpath.normpath(p.strip())
            for p in (os.environ.get("ALLOWED_PROJECT_BASES", "")).split(",")
            if p.strip()
        ]
        # A run/step with no runner heartbeat for this long is reaped as failed.
        self.run_stale_timeout: int = int(os.environ.get("RUN_STALE_TIMEOUT", "300"))

        # ---- Prompt capture ----
        # Shared secret the capture forwarder presents (Bearer). Maps to OWNER_EMAIL.
        self.capture_token: str = os.environ.get("CAPTURE_TOKEN", "")
        # Base under which captured `cwd`s are turned into project names. Per-user
        # override comes later; default to the first allowed project base or env.
        _cap_base = os.environ.get("CAPTURE_BASE", "").strip()
        self.capture_base: str = posixpath.normpath(_cap_base) if _cap_base else (
            self.allowed_project_bases[0] if self.allowed_project_bases else ""
        )

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

    @property
    def oauth_state_cookie_name(self) -> str:
        return "cue_oauth_state"

    @property
    def google_redirect_uri(self) -> str:
        """Must exactly match an Authorized redirect URI in the Google console."""
        return f"{self.allowed_origin.rstrip('/')}/api/auth/google/callback"

    def is_email_allowed(self, email: str) -> bool:
        """Allowlist check. With no lists configured, allow only in dev mode."""
        email = (email or "").strip().lower()
        if not email:
            return False
        if not self.allowed_emails and not self.allowed_domains:
            return self.dev_mode
        if email in self.allowed_emails:
            return True
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        return bool(domain) and domain in self.allowed_domains

    def is_path_allowed(self, path: str) -> bool:
        """String-only whitelist check for a run's project_path (no FS access).

        The path must be absolute, contain no NUL or `..` escapes, and equal or
        sit under one of `allowed_project_bases`. The runner re-validates on the
        machine that actually owns the filesystem (defense in depth).
        """
        if not path or "\x00" in path or not self.allowed_project_bases:
            return False
        norm = posixpath.normpath(path)
        if not posixpath.isabs(norm) or ".." in norm.split("/"):
            return False
        return any(
            norm == base or norm.startswith(base + "/")
            for base in self.allowed_project_bases
        )

    def capture_project_name(
        self, cwd: str, base: str | None = None, git_root: str | None = None
    ) -> str | None:
        """Project name derived from a captured cwd. Preferred: the git repo root
        (reported by the hook) relative to the base (per-user override, else
        `capture_base`), with `_`-prefixed grouping folders (e.g. `_customers`)
        skipped — so `_customers/celox/website` becomes "celox/website" instead
        of everything lumping into one "_customers" project. Fallback (no/old
        hook, no repo): the first path segment under the base. None if the cwd
        is outside the base."""
        base = posixpath.normpath(base) if base else self.capture_base
        if not base or not cwd:
            return None
        norm = posixpath.normpath(cwd)
        if norm != base and not norm.startswith(base + "/"):
            return None
        rest = norm[len(base):].lstrip("/")
        if not rest:
            return None
        if git_root:
            root = posixpath.normpath(git_root)
            if root.startswith(base + "/"):
                segments = root[len(base):].lstrip("/").split("/")
                visible = [s for s in segments if not s.startswith("_")]
                # Repo itself `_`-named (e.g. `_customers/_drafts`) -> keep its own name.
                return "/".join(visible) if visible else segments[-1]
        return rest.split("/", 1)[0]

    def ensure_dirs(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)
        Path(self.attachments_dir).mkdir(parents=True, exist_ok=True)

    def validate(self) -> None:
        """Fail fast on misconfiguration in production-ish setups."""
        problems: list[str] = []
        if not self.secret_key:
            problems.append("SECRET_KEY is not set")
        if not self.google_client_id:
            problems.append("GOOGLE_CLIENT_ID is not set")
        if not self.google_client_secret:
            problems.append("GOOGLE_CLIENT_SECRET is not set")
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
