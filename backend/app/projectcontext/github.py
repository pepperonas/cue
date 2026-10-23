"""The few GitHub REST calls cue makes — stdlib only, like the Google OAuth.

Everything goes through `request()`, which is the single seam tests replace.
cue only ever READS from GitHub; the OAuth scope is broader than that (GitHub
has no read-only scope for private repositories), which is why the token is
encrypted at rest and revoked at GitHub on disconnect.
"""
from __future__ import annotations

import base64
import json
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..config import get_settings

API = "https://api.github.com"
AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"  # noqa: S105 (URL, not a secret)
#: The scope private repositories need. There is no narrower one in OAuth Apps.
SCOPE = "repo"
TIMEOUT_S = 8
_DEADLINE: ContextVar[float | None] = ContextVar("github_deadline", default=None)


@contextmanager
def time_budget(seconds: float):
    """A refresh shares one budget across all GitHub requests."""
    token = _DEADLINE.set(time.monotonic() + seconds)
    try:
        yield
    finally:
        _DEADLINE.reset(token)


def _timeout() -> float:
    deadline = _DEADLINE.get()
    if deadline is None:
        return TIMEOUT_S
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise GitHubError(0, "GitHub-Kontext konnte nicht rechtzeitig geladen werden")
    return min(TIMEOUT_S, remaining)

JSON = "application/vnd.github+json"
RAW = "application/vnd.github.raw+json"
SHA = "application/vnd.github.sha"


class GitHubError(Exception):
    """A failed call. `status` 0 means the network, not GitHub, said no."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    accept: str = JSON,
    form: dict | None = None,
    body: dict | None = None,
    basic: tuple[str, str] | None = None,
) -> Any:
    """One HTTP call. JSON answers come back parsed, raw/sha answers as text."""
    data = None
    req = urllib.request.Request(url, method=method)
    req.add_header("Accept", accept)
    req.add_header("User-Agent", "cue")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if basic:
        pair = base64.b64encode(f"{basic[0]}:{basic[1]}".encode()).decode()
        req.add_header("Authorization", f"Basic {pair}")
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    elif body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=_timeout()) as resp:  # noqa: S310 (fixed GitHub hosts)
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode() or "{}").get("message", "")
        except Exception:  # noqa: BLE001
            pass
        raise GitHubError(exc.code, detail or f"GitHub antwortete mit {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GitHubError(0, "GitHub ist nicht erreichbar") from exc
    if accept in (RAW, SHA):
        return raw
    return json.loads(raw) if raw.strip() else None


def authorize_url(state: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "scope": SCOPE,
        "state": state,
        "allow_signup": "false",
    }
    return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


@dataclass(frozen=True)
class Credentials:
    access_token: str
    refresh_token: str | None = None
    expires_in: int | None = None


def _credentials(form: dict) -> Credentials:
    answer = request("POST", TOKEN_URL, accept="application/json", form=form)
    if not isinstance(answer, dict) or not isinstance(answer.get("access_token"), str) or not answer["access_token"]:
        error = answer.get("error") if isinstance(answer, dict) else None
        if error in {"bad_refresh_token", "invalid_grant"}:
            raise GitHubError(401, "GitHub-Zugang ist abgelaufen — bitte neu verbinden")
        raise GitHubError(400, "GitHub-Verbindung konnte nicht bestätigt werden")
    expires = answer.get("expires_in")
    return Credentials(
        access_token=answer["access_token"],
        refresh_token=answer.get("refresh_token") or None,
        expires_in=int(expires) if expires is not None else None,
    )


def exchange_credentials(code: str) -> Credentials:
    settings = get_settings()
    return _credentials({
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": code,
        "redirect_uri": settings.github_redirect_uri,
    })


def exchange_code(code: str) -> str:
    """Access-token-only convenience for callers that do not store a connection."""
    return exchange_credentials(code).access_token


def refresh_credentials(refresh_token: str) -> Credentials:
    settings = get_settings()
    return _credentials({
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    })


def current_login(token: str) -> str:
    user = request("GET", f"{API}/user", token=token)
    return str((user or {}).get("login") or "")


def list_repos(token: str, pages: int = 3) -> list[dict]:
    """Repos the account can read, most recently pushed first."""
    out: list[dict] = []
    for page in range(1, pages + 1):
        rows = request(
            "GET",
            f"{API}/user/repos?per_page=100&sort=pushed&page={page}",
            token=token,
        ) or []
        for r in rows:
            out.append({
                "full_name": r.get("full_name", ""),
                "default_branch": r.get("default_branch", ""),
                "private": bool(r.get("private")),
            })
        if len(rows) < 100:
            break
    return out


def revoke(token: str) -> None:
    """Withdraw cue's authorization at GitHub — not just forget it locally."""
    settings = get_settings()
    request(
        "DELETE",
        f"{API}/applications/{settings.github_client_id}/grant",
        basic=(settings.github_client_id, settings.github_client_secret),
        body={"access_token": token},
    )
