"""Shared FastAPI dependencies: auth guard and CSRF guard."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request, status

from .config import get_settings
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
