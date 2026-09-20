"""Die Übersteuerung des Optimierungs-Indikators (0.72.0).

Der Kern ist die Dreiwertigkeit: `null` heißt „kein Eingriff" und ist damit ein
BEDEUTUNGSVOLLER Wert — er lässt sich nicht dadurch setzen, dass man das Feld
wegläss. Genau das prüft die Hälfte der Tests hier.
"""
from __future__ import annotations

from conftest import auth


def hdr(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}


def prompt(client, csrf) -> dict:
    r = client.post("/api/prompts", json={"body": "Inhalt"}, headers=hdr(csrf))
    assert r.status_code == 201, r.text
    return r.json()


def test_a_fresh_prompt_has_no_override(client):
    csrf = auth(client)
    assert prompt(client, csrf)["optimized_manually"] is None


def test_marking_by_hand_is_stored_and_read_back(client):
    csrf = auth(client)
    p = prompt(client, csrf)
    r = client.patch(
        f"/api/prompts/{p['id']}", json={"optimized_manually": True}, headers=hdr(csrf)
    )
    assert r.status_code == 200
    assert r.json()["optimized_manually"] is True
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is True


def test_an_objection_is_stored_as_false_not_as_absent(client):
    """`false` und „nicht gesetzt" sind verschiedene Aussagen."""
    csrf = auth(client)
    p = prompt(client, csrf)
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": False}, headers=hdr(csrf))
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is False


def test_clearing_needs_its_own_switch(client):
    """⚠️ `optimized_manually: null` allein ist von „Feld weggelassen" nicht zu
    unterscheiden — deshalb der eigene Schalter, wie bei `unassign_project`."""
    csrf = auth(client)
    p = prompt(client, csrf)
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": True}, headers=hdr(csrf))

    # Ein mitgeschicktes `null` darf NICHTS tun.
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": None}, headers=hdr(csrf))
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is True

    # Der Schalter tut es.
    client.patch(
        f"/api/prompts/{p['id']}", json={"clear_optimized_manually": True}, headers=hdr(csrf)
    )
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is None


def test_an_unrelated_edit_leaves_the_override_alone(client):
    csrf = auth(client)
    p = prompt(client, csrf)
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": True}, headers=hdr(csrf))
    client.patch(f"/api/prompts/{p['id']}", json={"title": "Neuer Titel"}, headers=hdr(csrf))
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is True


def test_the_override_survives_a_status_change(client):
    """Es ist eine Aussage über den TEXT, nicht über die Spalte."""
    csrf = auth(client)
    p = prompt(client, csrf)
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": True}, headers=hdr(csrf))
    client.patch(f"/api/prompts/{p['id']}", json={"status": "done"}, headers=hdr(csrf))
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is True


def test_applying_an_optimization_clears_an_older_objection(client):
    """Eine neue Tatsache schlägt einen alten Einwand."""
    import json

    from conftest import RUNNER_HDR

    csrf = auth(client)
    p = prompt(client, csrf)
    client.patch(f"/api/prompts/{p['id']}", json={"optimized_manually": False}, headers=hdr(csrf))

    # Einen echten Lauf durchspielen …
    r = client.post("/api/optimizations", json={"prompt_id": p["id"]}, headers=hdr(csrf))
    assert r.status_code == 201, r.text
    job = r.json()
    client.post("/api/optimizations/claim", json={"runner_id": "t"}, headers=RUNNER_HDR)
    client.post(
        f"/api/optimizations/{job['id']}/result",
        json={"status": "succeeded", "optimized_text": "Besser formuliert."},
        headers=RUNNER_HDR,
    )
    # … und übernehmen.
    ok = client.post(f"/api/optimizations/{job['id']}/apply", headers=hdr(csrf))
    assert ok.status_code == 200, ok.text

    gelesen = client.get(f"/api/prompts/{p['id']}").json()
    assert gelesen["optimized_manually"] is None, "der Einwand hätte weichen müssen"
    assert gelesen["optimization_applied_at"] is not None
    assert json.loads("true")  # Sanity: der Test ist wirklich durchgelaufen


def test_prompts_from_before_the_field_read_as_no_override(client):
    """Migration: NULL ist der Bestand, und NULL heißt „kein Eingriff"."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    csrf = auth(client)
    p = prompt(client, csrf)
    with Session(db_module.engine) as s:
        zeile = s.get(Prompt, p["id"])
        zeile.optimized_manually = None
        s.add(zeile)
        s.commit()
    assert client.get(f"/api/prompts/{p['id']}").json()["optimized_manually"] is None
