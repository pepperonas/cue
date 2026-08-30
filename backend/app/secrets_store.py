"""Symmetric encryption for third-party secrets kept in the database.

Only one thing is stored this way today: a user's own Anthropic API key. It
matters because the key is **not ours** — a leaked row costs someone else money
— and because the nightly backup copies the database off the box
(`ops/cue-backup.sh`), so "the file is on a private server" is not the whole
threat model.

The key material is derived from `SECRET_KEY`, which the deployment already
treats as the crown jewel: anyone holding it can mint sessions anyway, so
binding the secrets to it adds no new place to guard. It does mean rotating
`SECRET_KEY` makes stored keys undecryptable — `decrypt` returns None rather
than raising, so the app degrades to "no key stored" instead of 500-ing, and
the user simply enters it again.

Fernet (AES-128-CBC + HMAC-SHA256) rather than a hand-rolled construction:
authenticated encryption with a random IV per message, so two users with the
same key do not produce the same ciphertext.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

_settings = get_settings()

# Domain-separated from every other use of SECRET_KEY (session signing, CSRF,
# OAuth state), so a weakness in one construction cannot be replayed into
# another.
_SALT = b"cue.secrets.v1"


def _fernet() -> Fernet:
    material = hashlib.pbkdf2_hmac(
        "sha256", _settings.secret_key.encode("utf-8"), _SALT, 200_000, dklen=32
    )
    return Fernet(base64.urlsafe_b64encode(material))


def encrypt(value: str) -> str:
    """Ciphertext for storage. An empty value stores as an empty string."""
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str | None) -> str | None:
    """Plaintext, or None when there is nothing usable.

    None covers all three "cannot read it" cases the same way — never stored,
    stored under a previous SECRET_KEY, or tampered with — because the caller's
    reaction is identical: behave as if no key is configured.
    """
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return None


def preview(value: str | None) -> str:
    """What the UI is allowed to see: enough to recognise, not enough to use.

    The key never travels back to the browser — a settings page that echoes the
    secret it stores turns every XSS and every screenshot into a key leak.
    """
    if not value:
        return ""
    tail = value[-4:]
    return f"…{tail}"
