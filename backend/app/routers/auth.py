"""Authentication: Google OAuth 2.0 (Authorization Code flow), logout, me.

The Authorization Code flow keeps the client secret server-side. We trust the
profile because both the token exchange and the userinfo fetch happen over TLS
directly against Google using our secret — no client-side token handling.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import require_csrf
from ..models import User, utcnow
from ..schemas import MeResponse, UserRead
from ..security import (
    csrf_from_session,
    issue_oauth_state,
    issue_session,
    oauth_state_valid,
    read_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])
_settings = get_settings()

_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"  # noqa: S105 (URL, not a secret)
_GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


def _set_session_cookie(response: Response, token: str) -> None:
    max_age = _settings.session_max_age
    response.set_cookie(
        key=_settings.cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=_settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        key=_settings.csrf_cookie_name,
        value=csrf_from_session(token) or "",
        max_age=max_age,
        httponly=False,
        secure=_settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def _clear_state_cookie(response: Response) -> None:
    response.delete_cookie(_settings.oauth_state_cookie_name, path="/")


def _post_form(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (fixed Google URL)
        return json.loads(resp.read().decode())


def _get_json(url: str, bearer: str) -> dict:
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {bearer}")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (fixed Google URL)
        return json.loads(resp.read().decode())


@router.get("/google/login")
def google_login() -> RedirectResponse:
    """Kick off the OAuth dance: redirect the browser to Google's consent screen."""
    state = issue_oauth_state()
    params = {
        "client_id": _settings.google_client_id,
        "redirect_uri": _settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    url = f"{_GOOGLE_AUTH}?{urllib.parse.urlencode(params)}"
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    # SameSite=Lax so the cookie survives Google's top-level redirect back to us.
    response.set_cookie(
        key=_settings.oauth_state_cookie_name,
        value=state,
        max_age=600,
        httponly=True,
        secure=_settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/google/callback")
def google_callback(
    request: Request,
    session: Session = Depends(get_session),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Handle Google's redirect: verify state, exchange the code, sign the user in."""
    def fail(reason: str) -> RedirectResponse:
        resp = RedirectResponse(f"/?auth_error={reason}", status_code=status.HTTP_302_FOUND)
        _clear_state_cookie(resp)
        return resp

    if error or not code:
        return fail("denied")

    cookie_state = request.cookies.get(_settings.oauth_state_cookie_name)
    if not oauth_state_valid(cookie_state, state):
        return fail("state")

    try:
        token_resp = _post_form(
            _GOOGLE_TOKEN,
            {
                "code": code,
                "client_id": _settings.google_client_id,
                "client_secret": _settings.google_client_secret,
                "redirect_uri": _settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        access_token = token_resp.get("access_token")
        if not access_token:
            return fail("token")
        info = _get_json(_GOOGLE_USERINFO, access_token)
    except Exception:
        return fail("google")

    sub = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    if not sub or not email or not info.get("email_verified", False):
        return fail("profile")
    if not _settings.is_email_allowed(email):
        return fail("forbidden")

    user = session.exec(select(User).where(User.google_sub == sub)).first()
    if user is None:
        user = User(google_sub=sub, email=email)
        session.add(user)
    user.email = email
    user.name = info.get("name", "") or ""
    user.picture = info.get("picture", "") or ""
    user.last_login_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)

    # First login of the configured owner claims any pre-multi-tenant rows.
    if _settings.owner_email and email == _settings.owner_email:
        session.exec(
            text("UPDATE project SET user_id = :uid WHERE user_id IS NULL").bindparams(uid=user.id)
        )
        session.exec(
            text("UPDATE prompt SET user_id = :uid WHERE user_id IS NULL").bindparams(uid=user.id)
        )
        session.commit()

    token = issue_session(user.id)
    response = RedirectResponse("/", status_code=status.HTTP_302_FOUND)
    _set_session_cookie(response, token)
    _clear_state_cookie(response)
    return response


@router.get("/me", response_model=MeResponse)
def me(request: Request, session: Session = Depends(get_session)) -> MeResponse:
    token = request.cookies.get(_settings.cookie_name)
    payload = read_session(token)
    if not payload or not isinstance(payload.get("uid"), int):
        return MeResponse(authenticated=False)
    user = session.get(User, payload["uid"])
    if not user:
        return MeResponse(authenticated=False)
    return MeResponse(
        authenticated=True,
        csrf_token=payload.get("csrf"),
        user=UserRead(email=user.email, name=user.name, picture=user.picture),
    )


@router.post("/logout")
def logout(response: Response, _csrf: None = Depends(require_csrf)) -> dict:
    response.delete_cookie(_settings.cookie_name, path="/")
    response.delete_cookie(_settings.csrf_cookie_name, path="/")
    return {"ok": True}
