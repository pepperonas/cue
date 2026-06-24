"""Auth & security primitives: password hashing, signed sessions, CSRF, ratelimit."""
from __future__ import annotations

import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import get_settings

_settings = get_settings()
_ph = PasswordHasher()

# Namespace/salt for the session signer.
_SESSION_SALT = "cue.session.v1"


def hash_password(password: str) -> str:
    """Produce an Argon2id hash string for storage in APP_PASSWORD_HASH."""
    return _ph.hash(password)


def verify_password(password: str) -> bool:
    """Constant-time-ish verification against the configured Argon2id hash.

    argon2-cffi's verify already runs the full KDF (constant work) and raises on
    mismatch; we additionally guard against an empty/missing hash.
    """
    stored = _settings.app_password_hash
    if not stored:
        return False
    try:
        return _ph.verify(stored, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def needs_rehash() -> bool:
    try:
        return _ph.check_needs_rehash(_settings.app_password_hash)
    except Exception:
        return False


# ---- Signed session tokens ----
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_settings.secret_key, salt=_SESSION_SALT)


def issue_session() -> str:
    """Create a signed session token. Payload is a random nonce + CSRF secret."""
    payload = {
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


# ---- In-memory login rate limiter (5 attempts / 15 min per IP) ----
@dataclass
class _RateLimiter:
    max_attempts: int = 5
    window_seconds: int = 15 * 60
    _hits: dict[str, deque[float]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._hits = defaultdict(deque)

    def _prune(self, ip: str, now: float) -> None:
        dq = self._hits[ip]
        cutoff = now - self.window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()

    def is_blocked(self, ip: str) -> bool:
        now = time.time()
        self._prune(ip, now)
        return len(self._hits[ip]) >= self.max_attempts

    def register_failure(self, ip: str) -> None:
        now = time.time()
        self._prune(ip, now)
        self._hits[ip].append(now)

    def reset(self, ip: str) -> None:
        self._hits.pop(ip, None)

    def retry_after(self, ip: str) -> int:
        dq = self._hits.get(ip)
        if not dq:
            return 0
        return max(0, int(self.window_seconds - (time.time() - dq[0])))


login_limiter = _RateLimiter()

# Global backstop: even if an attacker rotates/spoofs IPs, total failed login
# attempts are capped across all clients. Keyed on a single constant bucket.
global_login_limiter = _RateLimiter(max_attempts=30, window_seconds=15 * 60)
_GLOBAL_KEY = "__global__"
