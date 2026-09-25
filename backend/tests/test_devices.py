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


# ---------------------------------------------------------------------------
# HTTP: Verwaltung per Cookie, Nutzung per Bearer.

from conftest import auth  # noqa: E402


def _new_device(client, csrf, name="Pixel 8"):
    r = client.post("/api/devices", json={"name": name}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 201, r.text
    return r.json()


def test_creating_a_device_returns_the_token_exactly_once(client):
    csrf = auth(client)
    created = _new_device(client, csrf)
    assert len(created["token"]) == 64
    listed = client.get("/api/devices").json()
    assert [d["name"] for d in listed] == ["Pixel 8"]
    assert "token" not in listed[0]
    assert "token_hash" not in listed[0]


def test_the_token_is_not_in_the_database_in_plain_text(client):
    import sqlite3

    import app.db as db_module

    csrf = auth(client)
    token = _new_device(client, csrf)["token"]
    path = db_module.engine.url.database
    raw = sqlite3.connect(path).execute("select * from device").fetchall()
    assert token not in repr(raw)


def test_a_device_token_authenticates_the_app_routes(client):
    csrf = auth(client)
    token = _new_device(client, csrf)["token"]
    client.cookies.clear()
    r = client.get("/api/app/prompts", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_revoking_takes_effect_on_the_very_next_request(client):
    csrf = auth(client)
    created = _new_device(client, csrf)
    hdr = {"Authorization": f"Bearer {created['token']}"}
    assert client.get("/api/app/prompts", headers=hdr).status_code == 200
    r = client.delete(f"/api/devices/{created['id']}", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 204
    assert client.get("/api/app/prompts", headers=hdr).status_code == 401
    assert client.get("/api/devices").json()[0]["revoked_at"] is not None


import pytest  # noqa: E402


@pytest.mark.parametrize(
    "header",
    [None, "", "Bearer", "Bearer ", "bearer abc", "Token abc", "Bearer  " + "a" * 64, "Basic Zm9v"],
)
def test_malformed_authorization_is_401_never_500(client, header):
    client.cookies.clear()
    headers = {} if header is None else {"Authorization": header}
    assert client.get("/api/app/prompts", headers=headers).status_code == 401


def test_an_unapproved_account_gets_403_through_its_device(client):
    import app.db as db_module
    from app.models import User

    csrf = auth(client)
    token = _new_device(client, csrf)["token"]
    with Session(db_module.engine) as s:
        user = s.exec(select(User)).first()
        user.approved = False
        s.add(user)
        s.commit()
    client.cookies.clear()
    r = client.get("/api/app/prompts", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_a_foreign_device_cannot_be_revoked_and_gets_404(client):
    owner = auth(client, email="a@example.com", sub="a")
    created = _new_device(client, owner)
    intruder = auth(client, email="b@example.com", sub="b")
    r = client.delete(f"/api/devices/{created['id']}", headers={"X-CSRF-Token": intruder})
    assert r.status_code == 404
    assert client.get("/api/devices").json() == []


def test_a_blank_name_is_rejected(client):
    csrf = auth(client)
    r = client.post("/api/devices", json={"name": "   "}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 400
