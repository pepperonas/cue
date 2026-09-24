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


# ---------------------------------------------------------------------------
# GET /app/changes


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


def test_a_device_that_only_polls_changes_still_gets_touched(client):
    """`/app/changes` muss durch denselben Torwächter wie die übrigen
    App-Routen laufen — sonst bleibt `last_seen_at` für ein Gerät stehen, das
    nie `/app/prompts` aufruft, sondern nur long-pollt."""
    csrf, dev = _device(client)
    cookie = client.cookies.get("cue_session")
    client.cookies.clear()
    client.get("/api/app/changes", headers=dev)
    client.cookies.set("cue_session", cookie)
    listed = client.get("/api/devices").json()
    assert listed[0]["last_seen_at"] is not None


def test_a_revoked_device_is_thrown_out_of_a_parked_poll(client, monkeypatch):
    """Sperren muss auch den geparkten Long-Poll beenden — beim nächsten Tick,
    nicht nach Ablauf des Budgets.

    Die Sperrung muss dafür WÄHREND das Gerät schon geparkt wartet passieren
    (eigener Thread) — sperrt man es VOR der Anfrage, greift schon der äußere,
    unbedingte Check am Anfang von `app_changes` und `attempt` (der innere
    Check, den dieser Test eigentlich prüfen soll) wird nie erreicht. Muster
    wie `tests/test_changes.py::test_a_change_during_the_wait_is_picked_up_without_asking_again`.
    """
    import threading
    import time

    import app.db as db_module
    from sqlmodel import Session, select

    from app import longpoll
    from app.models import Device, utcnow

    monkeypatch.setattr(longpoll, "TICK_S", 0.05)
    _, dev = _device(client)
    client.cookies.clear()
    cursor = client.get("/api/app/changes", headers=dev).json()["cursor"]

    answers: list = []

    def wait_for_it():
        answers.append(client.get(f"/api/app/changes?since={cursor}&wait=5", headers=dev))

    waiter = threading.Thread(target=wait_for_it)
    began = time.monotonic()
    waiter.start()
    try:
        time.sleep(0.2)  # let it park — several ticks at TICK_S=0.05
        with Session(db_module.engine) as s:
            d = s.exec(select(Device)).first()
            d.revoked_at = utcnow()
            s.add(d)
            s.commit()
    finally:
        waiter.join(timeout=8)

    elapsed = time.monotonic() - began
    assert answers, "poll never answered"
    assert answers[0].status_code == 401
    assert elapsed < 2, f"answered after {elapsed:.1f}s — waited out the budget instead"
