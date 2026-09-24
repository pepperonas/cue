# Geräte-Token und `/api/app/` — Umsetzungsplan (Teil A: Backend + Web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Gerät bekommt einen eigenen, auf Prompts beschränkten Token, und es gibt genau eine neue Tür dafür: den Router `/api/app/`.

**Architecture:** Neue Tabelle `device` (nur der SHA-256 des Tokens wird gespeichert), eine neue Abhängigkeit `device_user_id` und ein eigener Router `/api/app/`, dessen Handler die bestehenden Prompt-/Projekt-/Tag-Handler **direkt aufrufen** — keine Regel wird zweimal formuliert. Verwaltung der Geräte über Cookie-Routen `/api/devices` und einen neuen Abschnitt in den Web-Einstellungen. `current_user_id` wird **nicht** angefasst.

**Tech Stack:** FastAPI, SQLModel/SQLite, pytest; React 18 + TypeScript + React Query im Frontend.

**Spec:** `docs/superpowers/specs/2026-09-24-android-app-design.md` (§ 3, § 7 Backend-Teil). Teil B (Android) steht in `docs/superpowers/plans/2026-09-24-android-b-app.md` und setzt diesen Teil voraus.

## Global Constraints

- Der Token wird mit `secrets.token_hex(32)` erzeugt und **genau einmal** ausgeliefert.
- In der Datenbank steht **nur** `sha256(token).hexdigest()` — nie der Token.
- `deps.current_user_id` bleibt unverändert; der Bearer-Token öffnet **keine** bestehende Route.
- `/api/app/` enthält genau: `GET /app/prompts`, `POST /app/prompts`, `PATCH /app/prompts/{prompt_id}`, `GET /app/projects`, `GET /app/tags`, `GET /app/changes`.
- `PATCH /app/prompts/{id}` nimmt nur `title`, `body`, `project_id`, `unassign_project`, `status`, `tags`, `bookmarked`, `priority` — alles andere ist **422** (nicht still ignoriert).
- Fremde Zeilen: **404, nie 403**.
- Sperren wirkt bei der **nächsten** Anfrage (Prüfung von `revoked_at` bei jeder Anfrage).
- Jeder Zeitstempel in `schemas.py` ist `Utc`, nie nacktes `datetime` (`test_wire_time.py`).
- Version: nur `backend/app/main.py` hochzählen (0.73.0 → **0.74.0**), CHANGELOG-Eintrag Pflicht (`test_docs.py`).
- Jede neue Zusicherung wird einmal mutiert und rot gesehen, bevor der Task als fertig gilt. **Vor dem Mutieren committen.**

## Review Focus

1. **Bearer-Header in anderer Schreibweise** (`bearer abc`, zusätzliche Leerzeichen, leerer Token) — erwartet 401, nie eine Ausnahme/500. → Test in Task 2.
2. **Gesperrtes Gerät mitten in einem geparkten `/app/changes`-Long-Poll** — erwartet 401 beim nächsten Tick, nicht nach Ablauf des Budgets. → Test in Task 4.
3. **Gerät eines Nutzers, dessen Freischaltung entzogen wurde** — erwartet 403 auf jeder `/app/`-Route (die App behandelt 401/403 gleich: lokale Kopie löschen). → Test in Task 2.
4. **`PATCH` mit einem Feld außerhalb der Teilmenge** (`tested`, `ai_model_id`) — erwartet 422, damit ein App-Fehler auffällt statt still zu verpuffen. → Test in Task 3.
5. **`last_seen_at` bei jeder Anfrage geschrieben** — jede App-Abfrage würde zu einem Schreibvorgang und bewegt ggf. Fingerabdrücke; erwartet: höchstens einmal pro Minute geschrieben. → Test in Task 2.

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `backend/app/models.py` (ändern) | Tabelle `Device` |
| `backend/app/devices.py` (neu) | Token erzeugen, hashen, auflösen, sperren — kein FastAPI |
| `backend/app/deps.py` (ändern) | `device_user_id` |
| `backend/app/schemas.py` (ändern) | `DeviceCreate`, `DeviceRead`, `DeviceCreated`, `AppPromptCreate`, `AppPromptUpdate` |
| `backend/app/routers/devices.py` (neu) | Cookie-Routen `/devices` |
| `backend/app/routers/app_api.py` (neu) | Bearer-Routen `/app/*` |
| `backend/app/main.py` (ändern) | Router einhängen, Version |
| `backend/tests/test_devices.py` (neu) | Token-Lebenszyklus, Verwaltung |
| `backend/tests/test_app_surface.py` (neu) | Fläche von `/app/` als Eigenschaft |
| `backend/tests/test_tenancy.py` (ändern) | `device_user_id` als Maschinen-Auth zulassen, `/app/changes` begründet |
| `frontend/src/lib/types.ts`, `lib/api.ts`, `state/queries.ts`, `lib/demo.ts` (ändern) | Geräte-Client |
| `frontend/src/components/DevicesSection.tsx` (neu) | Abschnitt „Geräte" in den Einstellungen |
| `frontend/src/components/SettingsView.tsx` (ändern) | Abschnitt einbinden |
| `docs/API.md`, `SECURITY.md`, `CHANGELOG.md`, `CLAUDE.md` (ändern) | Doku |

---

### Task 1: Tabelle `device` und Token-Logik

**Files:**
- Modify: `backend/app/models.py` (nach `class User`)
- Create: `backend/app/devices.py`
- Test: `backend/tests/test_devices.py`

**Interfaces:**
- Produces:
  - `models.Device` (Tabelle `device`: `id`, `user_id`, `name`, `token_hash`, `created_at`, `last_seen_at`, `revoked_at`)
  - `devices.hash_token(token: str) -> str`
  - `devices.issue(session: Session, uid: int, name: str) -> tuple[Device, str]` — gibt Zeile und Klartext-Token zurück, committet
  - `devices.resolve(session: Session, token: str) -> Device | None` — `None` bei unbekannt/gesperrt/leer
  - `devices.touch(session: Session, device: Device) -> None` — schreibt `last_seen_at` höchstens alle `TOUCH_INTERVAL` (60 s)
  - `devices.revoke(session: Session, device: Device) -> None`

- [ ] **Step 1: Failing tests schreiben**

`backend/tests/test_devices.py`:

```python
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
```

- [ ] **Step 2: Laufen lassen, rot sehen**

Run: `cd backend && uv run pytest tests/test_devices.py -v`
Expected: FAIL — `ImportError: cannot import name 'devices' from 'app'`

- [ ] **Step 3: Tabelle ergänzen**

In `backend/app/models.py`, direkt nach `class User`:

```python
class Device(SQLModel, table=True):
    """Ein Telefon, das auf die Prompts eines Kontos zugreifen darf.

    Gespeichert wird nur der SHA-256 des Tokens: die nächtliche Sicherung trägt
    diese Datenbank vom Server herunter. Gesperrt = `revoked_at` gesetzt; die
    Zeile bleibt stehen, damit die Einstellungen zeigen, WAS gesperrt wurde.
    """

    __tablename__ = "device"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str = Field(default="")
    token_hash: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=utcnow)
    last_seen_at: datetime | None = Field(default=None)
    revoked_at: datetime | None = Field(default=None)
```

`create_all` legt die neue Tabelle beim Start selbst an — keine Migration nötig (eine neue *Tabelle*, keine neue Spalte).

- [ ] **Step 4: `app/devices.py` schreiben**

```python
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
```

- [ ] **Step 5: Grün sehen**

Run: `cd backend && uv run pytest tests/test_devices.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/devices.py backend/tests/test_devices.py
git commit -m "feat(devices): Geraete-Tabelle, Token nur als Hash gespeichert"
```

- [ ] **Step 7: Mutationsprobe**

Nacheinander, jeweils Test rot sehen, dann `git checkout backend/app/devices.py`:
1. In `resolve` die Zeile `or device.revoked_at is not None` entfernen → `test_resolve_rejects_unknown_empty_and_revoked` rot.
2. In `touch` das `return` in der Intervall-Bedingung entfernen → `test_touch_writes_at_most_once_per_interval` rot.
3. In `issue` `token_hash=token` statt `hash_token(token)` → `test_issue_returns…` rot.

Prüfen, dass `git diff --stat` danach leer ist.

---

### Task 2: `device_user_id` und die Verwaltungs-Routen `/api/devices`

**Files:**
- Modify: `backend/app/deps.py`
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/devices.py`
- Modify: `backend/app/main.py` (Import in der `from .routers import (…)`-Liste + `api.include_router(devices.router)`)
- Test: `backend/tests/test_devices.py` (erweitern)

**Interfaces:**
- Consumes: `devices.issue/resolve/touch/revoke`, `models.Device` (Task 1)
- Produces:
  - `deps.device_user_id(authorization: str | None = Header(None), session: Session = Depends(get_session)) -> int`
  - `deps.bearer_token(authorization: str | None) -> str` — liefert den Token oder `""`
  - `schemas.DeviceCreate {name: str}`, `schemas.DeviceRead {id, name, created_at: Utc, last_seen_at: Utc | None, revoked_at: Utc | None}`, `schemas.DeviceCreated(DeviceRead) {token: str}`
  - Routen: `GET /devices`, `POST /devices` (201, `DeviceCreated`), `DELETE /devices/{device_id}` (204)

- [ ] **Step 1: Failing tests anhängen**

An `backend/tests/test_devices.py` anhängen:

```python
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
```

Hinweis zu `test_a_device_token_authenticates_the_app_routes`/`test_revoking…`: `/api/app/prompts` entsteht erst in Task 3. Diese zwei Tests bleiben bis dahin rot — das ist gewollt, sie bilden die Nahtstelle. Alle übrigen müssen am Ende dieses Tasks grün sein.

- [ ] **Step 2: Rot sehen**

Run: `cd backend && uv run pytest tests/test_devices.py -v`
Expected: die neuen Tests FAIL mit 404 (`/api/devices` existiert nicht)

- [ ] **Step 3: Schemas**

In `backend/app/schemas.py`, bei den übrigen Einstellungs-Schemas:

```python
class DeviceCreate(BaseModel):
    name: str


class DeviceRead(BaseModel):
    id: int
    name: str
    created_at: Utc
    last_seen_at: Utc | None = None
    revoked_at: Utc | None = None


class DeviceCreated(DeviceRead):
    #: Nur in dieser einen Antwort. Danach existiert der Token nur noch als Hash.
    token: str
```

- [ ] **Step 4: `device_user_id` in `deps.py`**

Import ergänzen: `from . import devices` und `from .models import User` steht schon. Dann ans Ende von `deps.py`:

```python
def bearer_token(authorization: str | None) -> str:
    """Der Token aus `Authorization: Bearer <token>`, sonst ``""``.

    Streng: genau ein Leerzeichen, genau das Wort `Bearer`. Alles andere ist
    kein Token — und damit 401, nie eine Ausnahme.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return ""
    token = authorization[len("Bearer ") :]
    return token if token and token == token.strip() else ""


def device_user_id(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> int:
    """Der Mandant hinter einem Geräte-Token.

    ⚠️ Bewusst KEINE Erweiterung von `current_user_id`: ein Bearer, der dort
    gälte, öffnete stillschweigend jede bestehende Route. Diese Abhängigkeit
    hängt nur an `/api/app/`, und was dort liegt, steht in einer Liste.
    """
    device = devices.resolve(session, bearer_token(authorization))
    if device is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device token")
    user = session.get(User, device.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device token")
    if not user.approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Konto wartet auf Freischaltung"
        )
    devices.touch(session, device)
    return user.id
```

- [ ] **Step 5: Router `routers/devices.py`**

```python
"""Geräte verwalten — per Cookie, aus den Web-Einstellungen.

Das Gerät selbst benutzt diese Routen nie; es spricht nur `/api/app/`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from .. import devices
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Device
from ..schemas import DeviceCreate, DeviceCreated, DeviceRead

router = APIRouter(prefix="/devices", tags=["devices"])


def _read(device: Device) -> DeviceRead:
    return DeviceRead(
        id=device.id,
        name=device.name,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        revoked_at=device.revoked_at,
    )


@router.get("", response_model=list[DeviceRead])
def list_devices(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[DeviceRead]:
    rows = session.exec(
        select(Device).where(Device.user_id == uid).order_by(Device.created_at.desc())
    ).all()
    return [_read(d) for d in rows]


@router.post("", response_model=DeviceCreated, status_code=status.HTTP_201_CREATED)
def create_device(
    payload: DeviceCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> DeviceCreated:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    device, token = devices.issue(session, uid, payload.name)
    return DeviceCreated(**_read(device).model_dump(), token=token)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    device_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    device = session.get(Device, device_id)
    if not device or device.user_id != uid:
        raise HTTPException(status_code=404, detail="Device not found")
    devices.revoke(session, device)
```

In `backend/app/main.py`: `devices` in die `from .routers import (…)`-Liste aufnehmen und nach `api.include_router(changes.router)` einfügen: `api.include_router(devices.router)`.

- [ ] **Step 6: Laufen lassen**

Run: `cd backend && uv run pytest tests/test_devices.py -v`
Expected: alle grün außer `test_a_device_token_authenticates_the_app_routes`, `test_revoking_takes_effect…`, `test_malformed_authorization…`, `test_an_unapproved_account…` (brauchen `/api/app/prompts`, Task 3)

- [ ] **Step 7: Commit**

```bash
git add backend/app/deps.py backend/app/schemas.py backend/app/routers/devices.py backend/app/main.py backend/tests/test_devices.py
git commit -m "feat(devices): Geraete per Cookie anlegen, auflisten, sperren"
```

---

### Task 3: Der Router `/api/app/` — Prompts, Projekte, Tags

**Files:**
- Create: `backend/app/routers/app_api.py`
- Modify: `backend/app/schemas.py` (`AppPromptCreate`, `AppPromptUpdate`)
- Modify: `backend/app/main.py` (`app_api` importieren + `api.include_router(app_api.router)`)
- Test: `backend/tests/test_app_surface.py`

**Interfaces:**
- Consumes: `deps.device_user_id` (Task 2); bestehend: `routers.prompts.list_prompts/create_prompt/update_prompt`, `routers.projects.list_projects`, `routers.tags.list_tags`, `schemas.PromptCreate/PromptUpdate/PromptRead/ProjectRead/TagListResponse`
- Produces:
  - `schemas.AppPromptCreate` (Felder: `title: str = ""`, `body: str`, `project_id: int | None = None`, `status: PromptStatus = queued`, `tags: str = ""`, `bookmarked: bool = False`, `priority: PromptPriority = normal`; `extra="forbid"`)
  - `schemas.AppPromptUpdate` (alle Felder optional: `title`, `body`, `project_id`, `unassign_project: bool = False`, `status`, `tags`, `bookmarked`, `priority`; `extra="forbid"`)
  - `app_api.APP_ROUTES: frozenset[str]` — die Soll-Liste, gegen die der Eigenschaftstest prüft
  - Routen `GET/POST /app/prompts`, `PATCH /app/prompts/{prompt_id}`, `GET /app/projects`, `GET /app/tags`

- [ ] **Step 1: Failing tests schreiben**

`backend/tests/test_app_surface.py`:

```python
"""Die Fläche von `/api/app/` als Eigenschaft.

Ein Geräte-Token darf Prompts lesen und schreiben — und sonst nichts. Das ist
keine Prüfung in jedem Handler, sondern die Abwesenheit der Routen. Diese
Datei hält fest, dass es dabei bleibt: eine neue Route unter `/app/` fällt
hier auf, statt still für jedes Telefon erreichbar zu werden.
"""
from __future__ import annotations

import pytest
from fastapi.routing import APIRoute

from conftest import auth


def _routes():
    from app.main import api

    def flatten(routes):
        for route in routes:
            included = getattr(route, "original_router", None)
            if included is not None:
                yield from flatten(included.routes)
            elif isinstance(route, APIRoute):
                yield route

    return list(flatten(api.routes))


def _label(route: APIRoute) -> str:
    return f"{sorted(route.methods - {'HEAD', 'OPTIONS'})[0]} {route.path}"


def _deps(dependant, found=None):
    found = set() if found is None else found
    for sub in dependant.dependencies:
        if getattr(sub, "call", None) is not None:
            found.add(sub.call.__name__)
        _deps(sub, found)
    return found


def test_the_app_surface_is_exactly_the_agreed_list():
    from app.routers.app_api import APP_ROUTES

    live = {_label(r) for r in _routes() if r.path.startswith("/app/")}
    assert live == set(APP_ROUTES)
    assert APP_ROUTES == {
        "GET /app/prompts",
        "POST /app/prompts",
        "PATCH /app/prompts/{prompt_id}",
        "GET /app/projects",
        "GET /app/tags",
        "GET /app/changes",
    }


def test_no_app_route_accepts_a_cookie_session():
    """Umgekehrt genauso: die App-Routen kennen nur den Geräte-Token."""
    for route in _routes():
        if not route.path.startswith("/app/"):
            continue
        names = _deps(route.dependant)
        assert "current_user_id" not in names, _label(route)
        assert "current_session" not in names, _label(route)


def test_device_user_id_is_used_nowhere_outside_app():
    for route in _routes():
        if route.path.startswith("/app/"):
            continue
        assert "device_user_id" not in _deps(route.dependant), _label(route)


# ---------------------------------------------------------------------------
# Verhalten


def _device(client, email="owner@example.com", sub=None):
    csrf = auth(client, email=email, sub=sub)
    token = client.post(
        "/api/devices", json={"name": "Telefon"}, headers={"X-CSRF-Token": csrf}
    ).json()["token"]
    return csrf, {"Authorization": f"Bearer {token}"}


def test_create_and_edit_go_through_the_same_rules_as_the_web(client):
    csrf, dev = _device(client)
    client.cookies.clear()
    r = client.post("/api/app/prompts", json={"body": "# Suche fixen\nmehr Text", "tags": "bug"}, headers=dev)
    assert r.status_code == 201, r.text
    prompt = r.json()
    # Titel-Ableitung aus der ersten Zeile — dieselbe Regel wie im Web.
    assert prompt["title"] == "Suche fixen"
    assert prompt["tags"] == "bug"

    r = client.patch(f"/api/app/prompts/{prompt['id']}", json={"title": "neu", "priority": "high"}, headers=dev)
    assert r.status_code == 200
    assert r.json()["title"] == "neu"
    assert r.json()["priority"] == "high"

    listed = client.get("/api/app/prompts", headers=dev).json()
    assert [p["id"] for p in listed] == [prompt["id"]]


def test_tags_written_by_the_app_land_in_the_vocabulary(client):
    """`TagService.set_for_prompt` muss durchlaufen, nicht nur der Cache-String."""
    _, dev = _device(client)
    client.cookies.clear()
    client.post("/api/app/prompts", json={"body": "x", "tags": "android"}, headers=dev)
    names = [t["name"] for t in client.get("/api/app/tags", headers=dev).json()["items"]]
    assert "android" in names


@pytest.mark.parametrize(
    "field,value",
    [("tested", True), ("blocked", True), ("test_closely", True), ("ai_model_id", 1),
     ("attachment_ids", [1]), ("optimized_manually", True), ("clear_optimized_manually", True)],
)
def test_fields_outside_the_subset_are_rejected_not_ignored(client, field, value):
    _, dev = _device(client)
    client.cookies.clear()
    pid = client.post("/api/app/prompts", json={"body": "x"}, headers=dev).json()["id"]
    r = client.patch(f"/api/app/prompts/{pid}", json={field: value}, headers=dev)
    assert r.status_code == 422


def test_a_foreign_prompt_is_404_through_a_device(client):
    owner_csrf = auth(client, email="a@example.com", sub="a")
    foreign = client.post("/api/prompts", json={"body": "geheim"}, headers={"X-CSRF-Token": owner_csrf}).json()
    _, dev = _device(client, email="b@example.com", sub="b")
    client.cookies.clear()
    r = client.patch(f"/api/app/prompts/{foreign['id']}", json={"title": "x"}, headers=dev)
    assert r.status_code == 404
    assert client.get("/api/app/prompts", headers=dev).json() == []


def test_a_foreign_project_cannot_be_assigned(client):
    owner_csrf = auth(client, email="a@example.com", sub="a")
    project = client.post("/api/projects", json={"name": "fremd"}, headers={"X-CSRF-Token": owner_csrf}).json()
    _, dev = _device(client, email="b@example.com", sub="b")
    client.cookies.clear()
    r = client.post("/api/app/prompts", json={"body": "x", "project_id": project["id"]}, headers=dev)
    assert r.status_code == 400


# Was ein Geräte-Token NICHT darf. 401, weil die Cookie-Routen ohne Cookie gar
# nicht erst einen Mandanten haben — kein 403, das die Existenz bestätigte.
FORBIDDEN_FOR_DEVICES = [
    ("GET", "/api/prompts"),
    ("POST", "/api/runs"),
    ("GET", "/api/runs"),
    ("POST", "/api/sessions/1/send"),
    ("POST", "/api/optimizations"),
    ("GET", "/api/stats"),  # prefix /stats, Route ""
    ("GET", "/api/snippets"),
    ("GET", "/api/export"),
    ("POST", "/api/attachments"),
    ("GET", "/api/admin/users"),
    ("GET", "/api/devices"),
]


@pytest.mark.parametrize("method,path", FORBIDDEN_FOR_DEVICES)
def test_a_device_token_opens_nothing_outside_app(client, method, path):
    _, dev = _device(client)
    client.cookies.clear()
    r = client.request(method, path, headers=dev, json={})
    # Genau 401: ohne Cookie haben die Cookie-Routen keinen Mandanten. Ein 404
    # hieße „Pfad gibt es nicht" und machte die Zeile wertlos.
    assert r.status_code == 401, (path, r.status_code)
```

- [ ] **Step 2: Rot sehen**

Run: `cd backend && uv run pytest tests/test_app_surface.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.app_api'`

Die Assertion verlangt genau 401 — ein Tippfehler im Pfad fiele als 404 sofort auf.

- [ ] **Step 3: App-Schemas**

In `backend/app/schemas.py` (unter `PromptUpdate`; `ConfigDict` aus `pydantic` importieren, falls noch nicht da):

```python
class AppPromptCreate(BaseModel):
    """Was die Android-App beim Anlegen schicken darf. Unbekanntes ist 422."""

    model_config = ConfigDict(extra="forbid")

    title: str = ""
    body: str
    project_id: int | None = None
    status: PromptStatus = PromptStatus.queued
    tags: str = ""
    bookmarked: bool = False
    priority: PromptPriority = PromptPriority.normal


class AppPromptUpdate(BaseModel):
    """Teilmenge von `PromptUpdate` (Entwurf § 3.1). Unbekanntes ist 422 —
    ein Feld, das die App schickt und der Server still verwirft, wäre ein
    Fehler, den niemand bemerkt."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    body: str | None = None
    project_id: int | None = None
    unassign_project: bool = False
    status: PromptStatus | None = None
    tags: str | None = None
    bookmarked: bool | None = None
    priority: PromptPriority | None = None
```

- [ ] **Step 4: `routers/app_api.py`**

```python
"""Die einzige Tür für Geräte-Token: `/api/app/`.

Was hier liegt, darf ein Telefon. Was hier fehlt, darf es nicht — nicht durch
eine Prüfung, sondern weil es die Route nicht gibt. `APP_ROUTES` ist die
Soll-Liste; `tests/test_app_surface.py` hält den Router daran fest.

Die Handler sind dünn: sie rufen die Cookie-Handler direkt auf. Titel-Ableitung,
Tag-Vokabular, Bug-nach-oben und Statusregeln existieren genau einmal.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from ..db import get_session
from ..deps import device_user_id
from ..schemas import (
    AppPromptCreate,
    AppPromptUpdate,
    ProjectRead,
    PromptCreate,
    PromptRead,
    PromptUpdate,
    TagListResponse,
)
from . import projects as projects_router
from . import prompts as prompts_router
from . import tags as tags_router

router = APIRouter(prefix="/app", tags=["app"])

APP_ROUTES = frozenset(
    {
        "GET /app/prompts",
        "POST /app/prompts",
        "PATCH /app/prompts/{prompt_id}",
        "GET /app/projects",
        "GET /app/tags",
        "GET /app/changes",
    }
)


@router.get("/prompts", response_model=list[PromptRead])
def app_list_prompts(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return prompts_router.list_prompts(
        project_id=None, status_filter=None, q=None, session=session, uid=uid
    )


@router.post("/prompts", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def app_create_prompt(
    payload: AppPromptCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    # Kein ai_model_id mitgeben: „weggelassen" heißt beim Web-Handler
    # „Standardmodell des Mandanten" (model_fields_set).
    return prompts_router.create_prompt(
        payload=PromptCreate(**payload.model_dump()), session=session, uid=uid, _csrf=None
    )


@router.patch("/prompts/{prompt_id}", response_model=PromptRead)
def app_update_prompt(
    prompt_id: int,
    payload: AppPromptUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return prompts_router.update_prompt(
        prompt_id=prompt_id,
        payload=PromptUpdate(**payload.model_dump(exclude_unset=True)),
        session=session,
        uid=uid,
        _csrf=None,
    )


@router.get("/projects", response_model=list[ProjectRead])
def app_list_projects(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return projects_router.list_projects(session=session, uid=uid)


@router.get("/tags", response_model=TagListResponse)
def app_list_tags(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return tags_router.list_tags(
        q=None, sort="usage", limit=2000, offset=0, session=session, uid=uid
    )
```

⚠️ Keine CSRF-Abhängigkeit: der Geräte-Token ist kein Cookie, ein Browser schickt ihn nie von selbst mit — CSRF hat hier keine Angriffsfläche (dasselbe gilt für `/capture` und `/sync`).

In `main.py`: `app_api` in die Router-Importliste, `api.include_router(app_api.router)`. `GET /app/changes` kommt in Task 4 — bis dahin ist `test_the_app_surface_is_exactly_the_agreed_list` rot, gewollt.

- [ ] **Step 5: Laufen lassen**

Run: `cd backend && uv run pytest tests/test_app_surface.py tests/test_devices.py -v`
Expected: alles grün außer `test_the_app_surface_is_exactly_the_agreed_list` (fehlt `/app/changes`)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/app_api.py backend/app/schemas.py backend/app/main.py backend/tests/test_app_surface.py
git commit -m "feat(app): /api/app/ fuer Geraete-Token — Prompts, Projekte, Tags"
```

- [ ] **Step 7: Mutationsprobe (nach dem Commit)**

1. In `AppPromptUpdate` `extra="forbid"` → `extra="ignore"` → `test_fields_outside_the_subset…` rot.
2. In `app_create_prompt` statt `create_prompt(…)` direkt `Prompt(...)` anlegen ist zu groß als Mutation; stattdessen in `routers/prompts.py:create_prompt` den `TagService`-Aufruf auskommentieren → `test_tags_written_by_the_app…` rot. Zurücksetzen.
3. Eine Zusatzroute `@router.get("/runs")` in `app_api.py` → `test_the_app_surface…` rot.
4. In `deps.bearer_token` `token == token.strip()` entfernen → Parameter `"Bearer  aaa…"` rot.

Jeweils `git checkout -- backend/` und `git diff --stat` leer.

---

### Task 4: `GET /api/app/changes` und die Tenancy-Eigenschaftstests

**Files:**
- Modify: `backend/app/routers/app_api.py`
- Modify: `backend/tests/test_tenancy.py`
- Test: `backend/tests/test_app_surface.py` (erweitern)

**Interfaces:**
- Consumes: `app.changes.fingerprint/encode/decode/changed`, `app.changes.PROMPTS/PROJECTS/TAGS`, `app.longpoll.claim_with_wait`, `devices.resolve`, `deps.bearer_token`
- Produces: `GET /app/changes?since=&wait=` → `{cursor: str, changed: list[str]}`, `changed` ⊆ `{"prompts","projects","tags"}`

- [ ] **Step 1: Failing tests anhängen**

An `backend/tests/test_app_surface.py`:

```python
def test_changes_reports_prompt_edits_and_nothing_else(client):
    csrf, dev = _device(client)
    cookie = client.cookies.get("cue_session")
    client.cookies.clear()
    start = client.get("/api/app/changes", headers=dev).json()
    assert start["changed"] == []

    # Ein Snippet ändert sich: die App kennt keine Snippets, also keine Meldung.
    client.cookies.set("cue_session", cookie)
    client.post("/api/snippets", json={"abbreviation": ";x", "body": "x"}, headers={"X-CSRF-Token": csrf})
    client.cookies.clear()
    quiet = client.get(f"/api/app/changes?since={start['cursor']}", headers=dev).json()
    assert quiet["changed"] == []

    client.post("/api/app/prompts", json={"body": "neu"}, headers=dev)
    moved = client.get(f"/api/app/changes?since={start['cursor']}", headers=dev).json()
    # Ein Prompt ohne Tags bewegt das Vokabular nicht.
    assert moved["changed"] == ["prompts"]


def test_changes_rejects_a_revoked_device(client):
    csrf, dev = _device(client)
    device_id = client.get("/api/devices").json()[0]["id"]
    client.delete(f"/api/devices/{device_id}", headers={"X-CSRF-Token": csrf})
    client.cookies.clear()
    assert client.get("/api/app/changes", headers=dev).status_code == 401


def test_a_revoked_device_is_thrown_out_of_a_parked_poll(client, monkeypatch):
    """Sperren muss auch den geparkten Long-Poll beenden — beim nächsten Tick,
    nicht nach Ablauf des Budgets."""
    import time

    import app.db as db_module
    from sqlmodel import Session, select

    from app import longpoll
    from app.models import Device, utcnow

    monkeypatch.setattr(longpoll, "TICK_S", 0.05)
    _, dev = _device(client)
    client.cookies.clear()
    cursor = client.get("/api/app/changes", headers=dev).json()["cursor"]
    with Session(db_module.engine) as s:
        d = s.exec(select(Device)).first()
        d.revoked_at = utcnow()
        s.add(d)
        s.commit()
    began = time.monotonic()
    r = client.get(f"/api/app/changes?since={cursor}&wait=5", headers=dev)
    assert r.status_code == 401
    assert time.monotonic() - began < 2
```

- [ ] **Step 2: Rot sehen**

Run: `cd backend && uv run pytest tests/test_app_surface.py -k changes -v`
Expected: FAIL mit 404

- [ ] **Step 3: Route implementieren**

In `app_api.py` ergänzen (Imports oben: `from fastapi import HTTPException, Header, Query`; `from pydantic import BaseModel`; `from .. import changes as changes_mod`; `from .. import db`; `from .. import devices`; `from ..deps import bearer_token`; `from ..longpoll import claim_with_wait`; `from ..models import User`):

```python
#: Was die App kennt. Snippets und Capture-Sitzungen bewegen den Cursor der
#: Web-App, sollen das Telefon aber nicht wecken.
APP_ENTITIES = (changes_mod.PROMPTS, changes_mod.PROJECTS, changes_mod.TAGS)


class AppChangeFeed(BaseModel):
    cursor: str
    changed: list[str] = []


def _app_fingerprint(session: Session, uid: int) -> dict[str, str]:
    full = changes_mod.fingerprint(session, uid)
    return {k: v for k, v in full.items() if k in APP_ENTITIES}


def _check_device(session: Session, token: str) -> int:
    device = devices.resolve(session, token)
    if device is None:
        raise HTTPException(status_code=401, detail="Invalid device token")
    user = session.get(User, device.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid device token")
    if not user.approved:
        raise HTTPException(status_code=403, detail="Konto wartet auf Freischaltung")
    return user.id


@router.get("/changes", response_model=AppChangeFeed)
async def app_changes(
    since: str | None = Query(None),
    wait: float = Query(0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Wie `/api/changes`, aber per Geräte-Token.

    ⚠️ Kein `Depends(get_session)` und kein `device_user_id`: die Anfrage kann
    bis zu 25 s geparkt sein, der Pool hat fünf Verbindungen (siehe
    `app/longpoll.py`). Das Gerät wird deshalb in JEDEM Versuch auf dessen
    eigener Sitzung neu geprüft — was nebenbei heißt, dass Sperren einen
    geparkten Poll beim nächsten Tick beendet.
    """
    token = bearer_token(authorization)
    with Session(db.engine) as s:  # db.engine spät — siehe app/longpoll.py
        uid = _check_device(s, token)
        before = changes_mod.decode(since)
        if not before:
            return AppChangeFeed(cursor=changes_mod.encode(_app_fingerprint(s, uid)))

    def attempt(session: Session) -> AppChangeFeed | None:
        _check_device(session, token)
        now = _app_fingerprint(session, uid)
        moved = changes_mod.changed(before, now)
        if not moved:
            return None
        return AppChangeFeed(cursor=changes_mod.encode(now), changed=moved)

    feed = await claim_with_wait(attempt, wait=wait)
    return feed if feed is not None else AppChangeFeed(cursor=changes_mod.encode(before))
```

Vorher prüfen: `grep -n "^PROMPTS\|^PROJECTS\|^TAGS" backend/app/changes.py` — die Konstanten müssen so heißen; sonst die tatsächlichen Namen verwenden. Und: `claim_with_wait` ruft `attempt` mit einer Session auf (`grep -n "def claim_with_wait" -A20 backend/app/longpoll.py`).

- [ ] **Step 4: Tenancy-Test nachziehen**

In `backend/tests/test_tenancy.py`:
- in `test_every_endpoint_is_either_tenant_scoped…` die Bedingung erweitern:
  ```python
  if names & {"current_user_id", "require_runner", "device_user_id"}:
      continue
  ```
- in `UNSCOPED_BY_DESIGN` ergänzen:
  ```python
  "GET /app/changes": (
      "long poll per Geräte-Token: nimmt bewusst keine Pool-Sitzung und prüft das "
      "Gerät in jedem Versuch neu (siehe routers/app_api.py)"
  ),
  ```
- Kommentar in `test_every_mutating_tenant_endpoint_requires_csrf` („machine endpoints carry a Bearer token instead") gilt für die App-Routen ebenso — keine Codeänderung nötig, weil sie nicht an `current_user_id` hängen.
- In `FOREIGN_ACCESS` eine Zeile: `("gerät sperren", "DELETE", "/api/devices/{device}", None)` und in `_make_resources` ein Gerät anlegen:
  ```python
  device = client.post("/api/devices", json={"name": "tel"}, headers=headers).json()
  ```
  und `"device": device["id"]` in das Rückgabe-Dict.

- [ ] **Step 5: Ganze Suite**

Run: `cd backend && uv run pytest -q`
Expected: alles grün. Falls `test_docs.py` rot ist (neue Routen fehlen in `docs/API.md`), ist das Task 6 — hier nur notieren, dass genau diese Tests rot sind.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/app_api.py backend/tests/test_tenancy.py backend/tests/test_app_surface.py
git commit -m "feat(app): /api/app/changes mit Pruefung des Geraets in jedem Versuch"
```

- [ ] **Step 7: Mutationsprobe**

1. In `attempt` die Zeile `_check_device(session, token)` entfernen → `test_a_revoked_device_is_thrown_out…` rot (Poll läuft bis zum Budget, liefert 200).
2. `_app_fingerprint` gibt `full` ungefiltert zurück → `test_changes_reports_prompt_edits_and_nothing_else` rot.
3. In `test_tenancy.py` `"device_user_id"` wieder aus der Menge nehmen → Strukturtest rot (beweist, dass er die App-Routen wirklich sieht).

---

### Task 5: Abschnitt „Geräte" in den Web-Einstellungen

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`, `frontend/src/state/queries.ts`, `frontend/src/lib/demo.ts`
- Create: `frontend/src/components/DevicesSection.tsx`
- Modify: `frontend/src/components/SettingsView.tsx`
- Test: `frontend/src/lib/demo.test.ts` (bestehend — ein Fall ergänzen)

**Interfaces:**
- Consumes: `GET/POST /api/devices`, `DELETE /api/devices/{id}` (Task 2)
- Produces: `types.Device {id, name, created_at, last_seen_at, revoked_at}`, `types.DeviceCreated = Device & {token: string}`; `api.listDevices()`, `api.createDevice(name)`, `api.revokeDevice(id)`; `useDevices()`, `useCreateDevice()`, `useRevokeDevice()`

- [ ] **Step 1: Failing Demo-Test**

In `frontend/src/lib/demo.test.ts` (Muster der vorhandenen Fälle übernehmen — `grep -n "capture/settings\|handleDemoRequest(" src/lib/demo.test.ts` zeigt den Aufruf):

```ts
describe('Geräte', () => {
  it('lists no devices and refuses to create one', () => {
    // `state` kommt aus dem `beforeEach(() => { state = seedDemo() })` oben in der Datei.
    expect(handleDemoRequest(state, 'GET', '/devices')).toEqual([])
    expect(() => handleDemoRequest(state, 'POST', '/devices', { name: 'x' })).toThrow(DemoRefusal)
  })
})
```

Run: `cd frontend && pnpm vitest run src/lib/demo.test.ts` → FAIL (GET wirft DemoRefusal)

- [ ] **Step 2: Demo, Typen, API, Queries**

`lib/demo.ts`, in der Tabelle neben `'/capture/settings'`:

```ts
  // Geräte-Token gibt es in der Demo nicht; die Liste ist leer, Anlegen
  // fällt in die allgemeine Ablehnung.
  '/devices': [],
```

`lib/types.ts`:

```ts
export interface Device {
  id: number
  name: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export interface DeviceCreated extends Device {
  token: string
}
```

`lib/api.ts`, neben den Capture-Methoden:

```ts
  listDevices: () => request<Device[]>('GET', '/devices'),
  createDevice: (name: string) => request<DeviceCreated>('POST', '/devices', { name }),
  revokeDevice: (id: number) => request<void>('DELETE', `/devices/${id}`),
```

(`Device`, `DeviceCreated` in den Typ-Import oben aufnehmen.)

`state/queries.ts`:

```ts
export function useDevices() {
  return useQuery({ queryKey: ['devices'], queryFn: () => api.listDevices() })
}

export function useCreateDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.createDevice(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })
}

export function useRevokeDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })
}
```

Run: `pnpm vitest run src/lib/demo.test.ts` → PASS

- [ ] **Step 3: `DevicesSection.tsx`**

Bestehende Bausteine: `Button` aus `./ui`, `InputDialog`, `Confirm`, `RelativeTime`, `copyText` aus `../lib/clipboard`, `useToast` (Import wie in `SettingsView.tsx` übernehmen).

```tsx
import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import { formatAge, parseTimestamp } from '../lib/relative-time'
import type { Device } from '../lib/types'
import { useCreateDevice, useDevices, useRevokeDevice } from '../state/queries'
import { useToast } from '../state/toast'
import { Confirm } from './Confirm'
import { InputDialog } from './InputDialog'
import { Button } from './ui'

/**
 * Geräte, die per eigenem Token auf die Prompts zugreifen (Android-App).
 *
 * Der Token erscheint genau einmal, direkt nach dem Anlegen. Danach existiert
 * er nur noch als Hash auf dem Server — wer ihn verliert, legt ein neues Gerät
 * an und sperrt das alte.
 */
// `RelativeTime` ist an Prompts gebunden (created_at/edited_at); hier genügt
// eine einmal gerechnete Angabe — die Liste lädt bei jedem Öffnen neu.
function age(iso: string): string {
  const stamp = parseTimestamp(iso)
  return stamp === null ? '' : formatAge(stamp, Date.now())
}

export function DevicesSection() {
  const { data: devices = [] } = useDevices()
  const create = useCreateDevice()
  const revoke = useRevokeDevice()
  const toast = useToast()
  const [naming, setNaming] = useState(false)
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)
  const [toRevoke, setToRevoke] = useState<Device | null>(null)

  return (
    <section className="settings-section">
      <h3>Geräte</h3>
      <p className="muted">
        Ein Gerät darf Prompts lesen, anlegen und bearbeiten — keine Runs, keine CLI, keine
        Optimierung. Sperren wirkt bei der nächsten Anfrage.
      </p>

      {devices.length === 0 && <p className="muted">Noch kein Gerät.</p>}
      <ul className="device-list">
        {devices.map((d) => (
          <li key={d.id} className="row" data-revoked={d.revoked_at ? 'true' : 'false'}>
            <span style={{ flex: 1 }}>
              <strong>{d.name}</strong>{' '}
              <span className="muted">
                {d.revoked_at ? (
                  `gesperrt ${age(d.revoked_at)}`
                ) : d.last_seen_at ? (
                  `zuletzt ${age(d.last_seen_at)}`
                ) : (
                  'noch nie verbunden'
                )}
              </span>
            </span>
            {!d.revoked_at && (
              <Button variant="outlined" icon="block" onClick={() => setToRevoke(d)}>
                Sperren
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Button variant="tonal" icon="add" onClick={() => setNaming(true)}>
        Gerät hinzufügen
      </Button>

      {fresh && (
        <div className="field">
          <label style={{ color: 'var(--danger)' }}>
            ⚠️ Nur jetzt sichtbar — in der App unter Einstellungen einfügen:
          </label>
          <div className="row">
            <code style={{ flex: 1, overflowWrap: 'anywhere' }}>{fresh.token}</code>
            <Button
              variant="filled"
              icon="content_copy"
              onClick={async () => {
                if (await copyText(fresh.token)) toast.show('Token kopiert', 'success')
              }}
            >
              Kopieren
            </Button>
          </div>
          <Button variant="text" onClick={() => setFresh(null)}>
            Fertig
          </Button>
        </div>
      )}

      {naming && (
        <InputDialog
          title="Gerät hinzufügen"
          label="Name"
          placeholder="Pixel 8"
          confirmLabel="Anlegen"
          validate={(v) => (v.trim() ? null : 'Name fehlt')}
          onCancel={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false)
            create.mutate(name.trim(), {
              onSuccess: (d) => setFresh({ name: d.name, token: d.token }),
              onError: () => toast.show('Gerät konnte nicht angelegt werden', 'error'),
            })
          }}
        />
      )}

      {toRevoke && (
        <Confirm
          title={`„${toRevoke.name}" sperren?`}
          message="Das Gerät verliert sofort den Zugriff und löscht beim nächsten Abgleich seine lokale Kopie."
          confirmLabel="Sperren"
          onCancel={() => setToRevoke(null)}
          onConfirm={() => {
            revoke.mutate(toRevoke.id)
            setToRevoke(null)
          }}
        />
      )}
    </section>
  )
}
```

Geprüfte Props (Stand 2026-09-24): `InputDialog {title, label, placeholder, initialValue, confirmLabel, icon, validate, onConfirm, onCancel}`, `Confirm {title, message, confirmLabel, onConfirm, onCancel}` — `Confirm` hat **kein** `danger`-Prop, sein Knopf ist bereits destruktiv gestaltet. `useToast` aus `../state/toast` und `formatAge(…)` prüfen, ob `formatAge` „vor 3 Minuten" liefert (dann liest sich „zuletzt vor 3 Minuten"). ⚠️ Die Umhüllung der Abschnitte aus `SettingsView.tsx` übernehmen (wie der Capture-Abschnitt dort gebaut ist), statt `settings-section` zu erfinden.

- [ ] **Step 4: Einbinden**

In `SettingsView.tsx` direkt nach dem Capture-Abschnitt `<DevicesSection />` einfügen (Import ergänzen).

- [ ] **Step 5: Prüfen**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: alles grün, keine neuen Lint-**Fehler**.

Im Browser (lokal, `CUE_DEV=1 COOKIE_SECURE=false uv run uvicorn app.main:app --port 8000` + `pnpm dev`): Gerät anlegen → Token erscheint einmal → Kopieren → „Fertig" → Liste zeigt „noch nie verbunden" → `curl -H "Authorization: Bearer <token>" localhost:8000/api/app/prompts` liefert 200 → Seite neu laden, Liste zeigt „zuletzt gerade eben" → Sperren → `curl` liefert 401. Beide Themes, 390 px ohne Querscrollen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(web): Geraete in den Einstellungen anlegen und sperren"
```

---

### Task 6: Doku, Version, Ausliefern

**Files:**
- Modify: `docs/API.md`, `SECURITY.md`, `CHANGELOG.md`, `CLAUDE.md`, `backend/app/main.py` (Version)

- [ ] **Step 1: Doku-Test rot sehen**

Run: `cd backend && uv run pytest tests/test_docs.py -v`
Expected: FAIL — `/devices`, `/devices/{device_id}`, `/app/prompts`, `/app/prompts/{prompt_id}`, `/app/projects`, `/app/tags`, `/app/changes` fehlen in `docs/API.md`, und 0.74.0 fehlt im CHANGELOG (nach dem Versionssprung).

- [ ] **Step 2: `docs/API.md`**

In der Tabelle „Wer darf was" eine Zeile:

```markdown
| `device_user_id` | ein nicht gesperrtes Gerät eines freigeschalteten Kontos | `Authorization: Bearer <Geräte-Token>` — **nur** unter `/app/`, kein Cookie, kein CSRF |
```

Zwei neue Abschnitte unter „Endpunkte" (Tabellenkopf wie bei den übrigen Abschnitten):

```markdown
### Geräte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/devices` | Geräte des Kontos, auch gesperrte. Nie mit Token. |
| `POST` | `/devices` | Gerät anlegen. Die Antwort trägt den Token — **einmal**; gespeichert wird nur sein SHA-256. |
| `DELETE` | `/devices/{device_id}` | Gerät sperren. Wirkt bei der nächsten Anfrage, auch in einem geparkten `/app/changes`. |

### App (Geräte-Token)

Die einzige Fläche, die ein Geräte-Token öffnet. Was hier fehlt — Runs, CLI,
Optimierung, Statistik, Snippets, Anhänge, Export —, erreicht ein Telefon nicht.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/app/prompts` | Alle Prompts des Kontos, in derselben Form wie `/prompts`. |
| `POST` | `/app/prompts` | Anlegen; dieselben Regeln wie `POST /prompts`. Unbekannte Felder → 422. |
| `PATCH` | `/app/prompts/{prompt_id}` | Ändern: nur `title`, `body`, `project_id`, `unassign_project`, `status`, `tags`, `bookmarked`, `priority`. Alles andere → 422. |
| `GET` | `/app/projects` | Projekte, nur lesen. |
| `GET` | `/app/tags` | Tag-Vokabular, nur lesen. |
| `GET` | `/app/changes` | Wie `/changes`, aber nur für `prompts`, `projects`, `tags`. |
```

Den Tabellenkopf aus einem bestehenden Abschnitt kopieren, falls er anders lautet.

- [ ] **Step 3: Version, CHANGELOG, SECURITY, CLAUDE**

`backend/app/main.py`: `version="0.74.0"`.

`CHANGELOG.md`, unter `## [Unreleased]`:

```markdown
## [0.74.0] - 2026-09-24

### Added
- **Geräte-Token** für die kommende Android-App: unter Einstellungen → Geräte
  lässt sich ein Gerät anlegen und jederzeit sperren. Der Token wird genau
  einmal angezeigt; auf dem Server liegt nur sein SHA-256.
- **`/api/app/`** — die einzige Fläche, die ein Geräte-Token öffnet: Prompts
  lesen, anlegen, bearbeiten; Projekte und Tags lesen; Änderungen abfragen.
  Runs, CLI-Senden, Optimierung und alles Übrige sind für ein Telefon nicht
  erreichbar, weil es die Routen dort nicht gibt.
```

`SECURITY.md`: einen Absatz „Geräte-Token" in den Abschnitt über Zugänge (Überschriften dort nachsehen): Wirkungsradius auf Prompts beschränkt; Hash statt Klartext; Sperren wirkt sofort; bewusst kein Zugriff auf Runs/CLI, weil ein verlorenes Telefon sonst ein Terminal-Zugang wäre; `capture_token`/`snippet_sync_token` stehen weiterhin im Klartext (offen, eigene Aufgabe).

`CLAUDE.md` (Architektur-Liste, nach „Prompt capture"): ein Eintrag **„Geräte-Token und `/api/app/` (0.74.0)"** mit: Router-Liste als Soll in `app_api.APP_ROUTES`, `device_user_id` nie außerhalb `/app/` (Test), Handler rufen Cookie-Handler direkt auf, `AppPromptUpdate` mit `extra="forbid"`, `/app/changes` ohne Pool-Sitzung + Geräteprüfung je Versuch, Hash statt Klartext, `last_seen_at` höchstens einmal pro Minute.

- [ ] **Step 4: Alle Suiten**

Run: `cd /Users/martin/claude/cue && npm test`
Expected: alle vier Suiten grün; `posttest` aktualisiert die README-Badges.

- [ ] **Step 5: Commit + Push**

```bash
git add -A
git status   # prüfen: keine .env, keine *.db
git commit -m "feat: Geraete-Token und /api/app/ (v0.74.0)"
git push
```

- [ ] **Step 6: Deploy**

Nach dem Muster in CLAUDE.md „Deployment" — **rsync ohne `--delete`** (die `.env` existiert nur auf dem Server):

```bash
rsync -az --exclude node_modules --exclude .venv --exclude data --exclude .git ./ root@69.62.121.168:/opt/cue/
ssh root@69.62.121.168 'cd /opt/cue && bash ops/deploy.sh'
```

Nachprüfen:

```bash
curl -s https://cue.celox.io/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://cue.celox.io/api/app/prompts   # 401
```

Dann im Browser: Gerät anlegen, mit `curl -H "Authorization: Bearer …" https://cue.celox.io/api/app/prompts` 200, sperren, 401. Das Testgerät danach gesperrt stehen lassen oder die Zeile ist harmlos — sie trägt keinen verwertbaren Token.
