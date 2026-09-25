"""Geräte-Token: erzeugen, auflösen, sperren. Kein FastAPI hier.

Anders als `capture_token`/`snippet_sync_token` (Klartext in `user`) wird hier
nur der Hash gespeichert. Ein SHA-256 genügt, weil der Token 256 Bit Zufall
trägt — ein langsamer Passwort-Hash schützt nur schwache Eingaben, und die
gibt es hier nicht. Der Vergleich läuft über den indizierten Hash, ein
Zeitseitenkanal verrät daher nichts über den Token.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .models import Device, utcnow

#: Wie oft `last_seen_at` höchstens geschrieben wird. Sonst wird jede
#: Leseanfrage der App zu einem Schreibvorgang.
TOUCH_INTERVAL = timedelta(seconds=60)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue(session: Session, uid: int, name: str) -> tuple[Device, str]:
    token = secrets.token_hex(32)
    device = Device(user_id=uid, name=name.strip()[:80], token_hash=hash_token(token))
    session.add(device)
    session.commit()
    session.refresh(device)
    return device, token


def resolve(session: Session, token: str) -> Device | None:
    if not token:
        return None
    device = session.exec(select(Device).where(Device.token_hash == hash_token(token))).first()
    if device is None or device.revoked_at is not None:
        return None
    return device


def _aware(value: datetime) -> datetime:
    # SQLite liefert naive Zeitstempel zurück, frisch geschriebene sind aware.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def touch(session: Session, device: Device) -> None:
    now = utcnow()
    if device.last_seen_at is not None and now - _aware(device.last_seen_at) < TOUCH_INTERVAL:
        return
    device.last_seen_at = now
    session.add(device)
    session.commit()


def revoke(session: Session, device: Device) -> None:
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        session.add(device)
        session.commit()
