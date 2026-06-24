"""Authentication endpoints: login, logout, me, change-password."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..config import get_settings
from ..deps import current_session, get_client_ip, require_csrf
from ..schemas import ChangePasswordRequest, LoginRequest, MeResponse
from ..security import (
    csrf_from_session,
    global_login_limiter,
    hash_password,
    issue_session,
    login_limiter,
    verify_password,
)
from ..security import _GLOBAL_KEY  # global backstop bucket key

router = APIRouter(prefix="/auth", tags=["auth"])
_settings = get_settings()


def _set_session_cookie(response: Response, token: str, remember: bool) -> None:
    max_age = _settings.session_max_age if remember else None
    response.set_cookie(
        key=_settings.cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=_settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    # CSRF token mirror cookie (readable by JS for the double-submit header).
    csrf = csrf_from_session(token) or ""
    response.set_cookie(
        key=_settings.csrf_cookie_name,
        value=csrf,
        max_age=max_age,
        httponly=False,
        secure=_settings.cookie_secure,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=MeResponse)
def login(payload: LoginRequest, request: Request, response: Response) -> MeResponse:
    ip = get_client_ip(request)
    if login_limiter.is_blocked(ip) or global_login_limiter.is_blocked(_GLOBAL_KEY):
        retry = max(login_limiter.retry_after(ip), global_login_limiter.retry_after(_GLOBAL_KEY))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again later.",
            headers={"Retry-After": str(retry)},
        )

    if not verify_password(payload.password):
        login_limiter.register_failure(ip)
        global_login_limiter.register_failure(_GLOBAL_KEY)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    login_limiter.reset(ip)
    global_login_limiter.reset(_GLOBAL_KEY)
    token = issue_session()
    _set_session_cookie(response, token, payload.remember)
    return MeResponse(authenticated=True, csrf_token=csrf_from_session(token))


@router.post("/logout")
def logout(response: Response, _csrf: None = Depends(require_csrf)) -> dict:
    response.delete_cookie(_settings.cookie_name, path="/")
    response.delete_cookie(_settings.csrf_cookie_name, path="/")
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(request: Request) -> MeResponse:
    token = request.cookies.get(_settings.cookie_name)
    csrf = csrf_from_session(token)
    if not csrf:
        return MeResponse(authenticated=False)
    return MeResponse(authenticated=True, csrf_token=csrf)


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    _session: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> dict:
    if not verify_password(payload.current_password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Current password is wrong")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password too short")

    new_hash = hash_password(payload.new_password)
    # Single-user app: the hash lives in .env, which the running process can't
    # rewrite safely. Return the new hash so the operator can update .env and
    # restart. This keeps secrets out of the database.
    return {
        "ok": True,
        "new_password_hash": new_hash,
        "note": "Update APP_PASSWORD_HASH in .env with this value and restart the container.",
    }
