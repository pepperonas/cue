"""The few GitHub REST calls cue makes — stdlib only, like the Google OAuth.

Everything goes through `request()`, which is the single seam tests replace.
cue only ever READS from GitHub; the OAuth scope is broader than that (GitHub
has no read-only scope for private repositories), which is why the token is
encrypted at rest and revoked at GitHub on disconnect.
"""
from __future__ import annotations

import base64
import json
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
        with urllib.request.urlopen(req, data=data, timeout=TIMEOUT_S) as resp:  # noqa: S310 (fixed GitHub hosts)
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
    if accept != JSON:
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


def exchange_code(code: str) -> str:
    """The access token for an OAuth code. GitHub reports errors with 200."""
    settings = get_settings()
    answer = request(
        "POST",
        TOKEN_URL,
        accept="application/json",
        form={
            "client_id": settings.github_client_id,
            "client_secret": settings.github_client_secret,
            "code": code,
            "redirect_uri": settings.github_redirect_uri,
        },
    )
    token = (answer or {}).get("access_token") if isinstance(answer, dict) else None
    if not token:
        raise GitHubError(400, (answer or {}).get("error_description", "Kein Token erhalten"))
    return token


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
