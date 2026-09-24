"""Geräte-Token: Lebenszyklus ohne HTTP.

Der Token ist das Einzige, was ein verlorenes Telefon verrät. Deshalb steht in
der Datenbank nur sein Hash, und deshalb prüfen diese Tests zuerst die
negativen Fälle — ein kaputter Vergleich lässt jeden Glücksfall weiter grün.
"""
from __future__ import annotations

from datetime import timedelta

from sqlmodel import Session, select

from conftest import make_user


def _session():
    import app.db as db_module

    return Session(db_module.engine)


def test_issue_returns_a_token_once_and_stores_only_its_hash(client):
    from app import devices
    from app.models import Device

    uid = make_user()
    with _session() as s:
        device, token = devices.issue(s, uid, "Pixel 8")
        assert len(token) == 64
        row = s.get(Device, device.id)
        assert row.token_hash == devices.hash_token(token)
        assert row.token_hash != token
        # Nirgends in der Zeile steht der Klartext.
        assert token not in repr(row.model_dump())


def test_resolve_finds_the_device_for_its_token(client):
    from app import devices

    uid = make_user()
    with _session() as s:
        device, token = devices.issue(s, uid, "Pixel 8")
        assert devices.resolve(s, token).id == device.id


def test_resolve_rejects_unknown_empty_and_revoked(client):
    from app import devices

    uid = make_user()
    with _session() as s:
        device, token = devices.issue(s, uid, "Pixel 8")
        assert devices.resolve(s, "") is None
        assert devices.resolve(s, "0" * 64) is None
        assert devices.resolve(s, token.upper()) is None
        devices.revoke(s, device)
        assert devices.resolve(s, token) is None


def test_touch_writes_at_most_once_per_interval(client):
    from app import devices
    from app.models import Device, utcnow

    uid = make_user()
    with _session() as s:
        device, _ = devices.issue(s, uid, "Pixel 8")
        devices.touch(s, device)
        first = s.get(Device, device.id).last_seen_at
        assert first is not None
        devices.touch(s, device)
        assert s.get(Device, device.id).last_seen_at == first
        # Eine Minute zurückdatiert: jetzt muss es schreiben.
        device.last_seen_at = utcnow() - devices.TOUCH_INTERVAL - timedelta(seconds=1)
        s.add(device)
        s.commit()
        stale = device.last_seen_at
        devices.touch(s, device)
        assert s.get(Device, device.id).last_seen_at != stale


def test_two_issues_give_two_different_tokens(client):
    from app import devices
    from app.models import Device

    uid = make_user()
    with _session() as s:
        _, a = devices.issue(s, uid, "A")
        _, b = devices.issue(s, uid, "B")
        assert a != b
        assert len(s.exec(select(Device)).all()) == 2
