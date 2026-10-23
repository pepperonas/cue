"""Encrypted per-user GitHub credentials, including automatic token rotation.

GitHub consumes refresh tokens once. cue is one process, so serialize the rare
refresh and re-read the row under the lock before spending its refresh token.
The usual (still valid) token path performs no network or commit.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from sqlmodel import Session

from .. import secrets_store
from ..models import User
from . import github

_refresh_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def store(user: User, credentials: github.Credentials) -> None:
    user.github_token_enc = secrets_store.encrypt(credentials.access_token)
    user.github_refresh_token_enc = (
        secrets_store.encrypt(credentials.refresh_token) if credentials.refresh_token else None
    )
    user.github_token_expires_at = (
        _now() + timedelta(seconds=credentials.expires_in)
        if credentials.expires_in is not None else None
    )


def clear(user: User) -> None:
    user.github_token_enc = None
    user.github_refresh_token_enc = None
    user.github_token_expires_at = None
    user.github_login = None


def _due(user: User) -> bool:
    expiry = user.github_token_expires_at
    if expiry is None:
        return False
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry <= _now() + timedelta(seconds=60)


def access_token(session: Session, user: User | None) -> str | None:
    if user is None:
        return None
    token = secrets_store.decrypt(user.github_token_enc)
    if not token or not _due(user):
        return token
    with _refresh_lock:
        session.refresh(user)
        if not _due(user):
            return secrets_store.decrypt(user.github_token_enc)
        refresh = secrets_store.decrypt(user.github_refresh_token_enc)
        if not refresh:
            clear(user)
            session.add(user)
            session.commit()
            raise github.GitHubError(401, "GitHub-Zugang ist abgelaufen — bitte neu verbinden")
        try:
            credentials = github.refresh_credentials(refresh)
        except github.GitHubError as exc:
            if exc.status == 401:
                clear(user)
                session.add(user)
                session.commit()
            # A network failure must preserve the connection for the next try.
            raise
        store(user, credentials)
        session.add(user)
        session.commit()
        return credentials.access_token
