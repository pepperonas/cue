"""Connect a GitHub account — the source of the AI's project context.

The flow mirrors the Google sign-in, with one difference that matters: the
session cookie is SameSite=Strict and is NOT sent on GitHub's redirect back, so
the callback learns WHO is connecting from the signed state
(`security.issue_github_state`), never from the session or an e-mail address.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from .. import secrets_store
from ..config import get_settings
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import User
from ..projectcontext import github
from ..schemas import GitHubRepo, GitHubStatus
from ..security import github_state_user, issue_github_state

router = APIRouter(prefix="/github", tags=["github"])
log = logging.getLogger("cue.github")

STATE_COOKIE = "cue_github_state"


def _require_configured() -> None:
    if not get_settings().github_configured:
        raise HTTPException(status_code=404, detail="GitHub ist auf diesem Server nicht eingerichtet")


def _token(session: Session, uid: int) -> str:
    user = session.get(User, uid)
    token = secrets_store.decrypt(user.github_token_enc) if user else None
    if not token:
        raise HTTPException(status_code=400, detail="GitHub ist nicht verbunden")
    return token


@router.get("/status", response_model=GitHubStatus)
def github_status(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> GitHubStatus:
    user = session.get(User, uid)
    connected = bool(user and secrets_store.decrypt(user.github_token_enc))
    return GitHubStatus(
        configured=get_settings().github_configured,
        connected=connected,
        login=(user.github_login if connected and user else None),
    )


@router.get("/connect")
def github_connect(uid: int = Depends(current_user_id)) -> RedirectResponse:
    """Send the browser to GitHub's consent screen."""
    _require_configured()
    state = issue_github_state(uid)
    response = RedirectResponse(github.authorize_url(state), status_code=status.HTTP_302_FOUND)
    # Lax, so it survives GitHub's top-level redirect back to us.
    response.set_cookie(
        key=STATE_COOKIE,
        value=state,
        max_age=600,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        path="/api/github",
    )
    return response


@router.get("/callback")
def github_callback(
    request: Request,
    session: Session = Depends(get_session),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    def done(query: str) -> RedirectResponse:
        resp = RedirectResponse(f"/?{query}", status_code=status.HTTP_302_FOUND)
        resp.delete_cookie(STATE_COOKIE, path="/api/github")
        return resp

    if not get_settings().github_configured:
        return done("github_error=config")
    uid = github_state_user(request.cookies.get(STATE_COOKIE), state)
    if uid is None:
        return done("github_error=state")
    if error or not code:
        return done("github_error=denied")
    user = session.get(User, uid)
    if user is None or not user.approved:
        return done("github_error=state")
    try:
        token = github.exchange_code(code)
        login = github.current_login(token)
    except github.GitHubError as exc:
        log.info("github connect failed uid=%s: %s", uid, exc.message)
        return done("github_error=exchange")
    user.github_token_enc = secrets_store.encrypt(token)
    user.github_login = login or None
    session.add(user)
    session.commit()
    log.info("github connected uid=%s login=%s", uid, login)
    return done("github=connected")


@router.get("/repos", response_model=list[GitHubRepo])
def github_repos(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[GitHubRepo]:
    _require_configured()
    token = _token(session, uid)
    try:
        return [GitHubRepo(**r) for r in github.list_repos(token)]
    except github.GitHubError as exc:
        if exc.status == 401:
            user = session.get(User, uid)
            user.github_token_enc = None
            user.github_login = None
            session.add(user)
            session.commit()
            raise HTTPException(status_code=400, detail="GitHub-Zugang ist abgelaufen — bitte neu verbinden") from exc
        raise HTTPException(status_code=502, detail=exc.message) from exc


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT)
def github_disconnect(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    """Withdraw the authorization at GitHub, then forget the token here.

    A failing revoke (GitHub down, token already dead) must not keep the token
    stored: the user asked to disconnect, and that part we can always do.
    """
    user = session.get(User, uid)
    token = secrets_store.decrypt(user.github_token_enc) if user else None
    if token and get_settings().github_configured:
        try:
            github.revoke(token)
        except github.GitHubError as exc:
            log.info("github revoke failed uid=%s: %s", uid, exc.message)
    if user is not None:
        user.github_token_enc = None
        user.github_login = None
        session.add(user)
        session.commit()
