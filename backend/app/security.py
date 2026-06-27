"""Auth & security primitives: signed sessions, CSRF, OAuth-state tokens."""
from __future__ import annotations

import hmac
import secrets
import time

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import get_settings

_settings = get_settings()

# Namespaces/salts for the signers (rotating the salt invalidates old tokens).
_SESSION_SALT = "cue.session.v2"  # v2: payload now carries the user id
_STATE_SALT = "cue.oauth-state.v1"


# ---- Signed session tokens ----
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_settings.secret_key, salt=_SESSION_SALT)


def issue_session(user_id: int) -> str:
    """Create a signed session token bound to a user, with an embedded CSRF secret."""
    payload = {
        "uid": user_id,
        "nonce": secrets.token_urlsafe(16),
        "csrf": secrets.token_urlsafe(24),
        "iat": int(time.time()),
    }
    return _serializer().dumps(payload)


def read_session(token: str | None, max_age: int | None = None) -> dict | None:
    """Validate a session token and return its payload, or None if invalid."""
    if not token:
        return None
    age = max_age if max_age is not None else _settings.session_max_age
    try:
        return _serializer().loads(token, max_age=age)
    except (BadSignature, SignatureExpired):
        return None
    except Exception:
        return None


def csrf_from_session(token: str | None) -> str | None:
    payload = read_session(token)
    if not payload:
        return None
    return payload.get("csrf")


def csrf_matches(session_token: str | None, header_token: str | None) -> bool:
    """Double-submit check: header token must equal the session's csrf secret."""
    expected = csrf_from_session(session_token)
    if not expected or not header_token:
        return False
    return hmac.compare_digest(expected, header_token)


# ---- OAuth state tokens (CSRF protection for the Google redirect dance) ----
_STATE_MAX_AGE = 10 * 60  # 10 minutes to complete the login round-trip


def _state_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_settings.secret_key, salt=_STATE_SALT)


def issue_oauth_state() -> str:
    return _state_serializer().dumps({"n": secrets.token_urlsafe(16)})


def oauth_state_valid(cookie_value: str | None, returned_value: str | None) -> bool:
    """The state echoed back by Google must match our freshly-signed cookie."""
    if not cookie_value or not returned_value:
        return False
    if not hmac.compare_digest(cookie_value, returned_value):
        return False
    try:
        _state_serializer().loads(cookie_value, max_age=_STATE_MAX_AGE)
        return True
    except (BadSignature, SignatureExpired):
        return False
    except Exception:
        return False
