"""Shared FastAPI dependencies: auth guard and CSRF guard."""
from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException, Request, status
from sqlmodel import Session

from .config import get_settings
from .db import get_session
from .models import User
from .security import csrf_matches, read_session

_settings = get_settings()


def get_client_ip(request: Request) -> str:
    """Client IP for rate limiting.

    X-Forwarded-For is client-controllable and is only honored when TRUST_PROXY
    is set (the proxy on the VPS rewrites it). When trusted, the rightmost entry
    is the address our own proxy observed and appended — using the leftmost would
    let a client prepend a spoofed value to rotate buckets. When untrusted, the
    real socket peer is used.
    """
    if _settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def current_session(request: Request) -> dict:
    """Require a valid session cookie. Raises 401 otherwise."""
    token = request.cookies.get(_settings.cookie_name)
    payload = read_session(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return payload


def current_user_id(
    session: dict = Depends(current_session),
    db: Session = Depends(get_session),
) -> int:
    """The authenticated + APPROVED tenant's user id.

    Every data router hangs off this dependency, so revoking a user's approval
    locks them out on their very next request (no waiting for session expiry).
    """
    uid = session.get("uid")
    if not isinstance(uid, int):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not user.approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Konto wartet auf Freischaltung"
        )
    return uid


def require_owner(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> int:
    """Restrict to the configured OWNER_EMAIL (the run feature executes code on
    the runner's machine, so it must not be open to other allowlisted users)."""
    owner = _settings.owner_email
    if owner:
        user = session.get(User, uid)
        if not user or (user.email or "").strip().lower() != owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner only")
    elif not _settings.dev_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Run feature not configured")
    return uid


def require_runner(
    authorization: str | None = Header(default=None),
) -> None:
    """Guard runner-only endpoints with the shared RUNNER_TOKEN (Bearer)."""
    token = _settings.runner_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Runner not configured")
    expected = f"Bearer {token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid runner token")


def require_csrf(
    request: Request,
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _session: dict = Depends(current_session),
) -> None:
    """Double-submit CSRF guard for all mutating requests.

    Also enforces a strict Origin/Referer check when the headers are present.
    """
    token = request.cookies.get(_settings.cookie_name)
    if not csrf_matches(token, x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")

    origin = request.headers.get("origin")
    if origin and origin != _settings.allowed_origin and not _settings.dev_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin not allowed")
