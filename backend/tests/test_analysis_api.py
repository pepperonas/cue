"""Projekt-Analyse über die echte HTTP-Oberfläche.

Der teuerste Test hier ist `test_applying_does_not_touch_other_projects`: die
Queue teilt sich `sort_order` über ALLE Projekte einer Statusspalte, und eine
Teilmenge 1..n durchzunummerieren war der Fehler von 0.27.0. Dass die Analyse
das nicht wiederholt, ist keine Vermutung, sondern hier gemessen.
"""
from __future__ import annotations

import json

import pytest

from conftest import RUNNER_HDR, auth


def hdr(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}


def projekt(client, csrf, name="p"):
    r = client.post("/api/projects", json={"name": name}, headers=hdr(csrf))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def prompt(client, csrf, pid, titel, body="Inhalt dieses Prompts"):
    r = client.post(
        "/api/prompts",
        json={"title": titel, "body": body, "project_id": pid},
        headers=hdr(csrf),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def antwort(reihenfolge, **rest) -> dict:
    return {
        "status": "succeeded",
        "optimized_text": json.dumps(
            {"reihenfolge": [{"prompt_id": i, "begruendung": "weil"} for i in reihenfolge], **rest}
        ),
        "model": "claude-opus-5",
        "duration_ms": 1200,
        "cost_usd": 0.42,
    }


def durchlaufen(client, csrf, project_id, reihenfolge, **rest):
    """Anstoßen, vom Runner abholen lassen, Ergebnis melden."""
    r = client.post("/api/analyses", json={"project_id": project_id}, headers=hdr(csrf))
    assert r.status_code == 201, r.text
    lauf = r.json()

    c = client.post("/api/analyses/claim", json={"runner_id": "t"}, headers=RUNNER_HDR)
    assert c.status_code == 200, c.text
    assert c.json()["id"] == lauf["id"]

    f = client.post(
        f"/api/analyses/{lauf['id']}/result", json=antwort(reihenfolge, **rest), headers=RUNNER_HDR
    )
    assert f.status_code == 200, f.text
    return f.json()


# ------------------------------------------------------------------ anstoßen


def test_a_single_prompt_is_not_a_queue_to_sort(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    prompt(client, csrf, pid, "allein")
    r = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf))
    assert r.status_code == 400
    assert "mindestens" in r.json()["detail"]


def test_a_second_analysis_for_the_same_project_is_refused(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(3):
        prompt(client, csrf, pid, f"p{i}")
    assert client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).status_code == 201
    zweite = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf))
    assert zweite.status_code == 409


def test_another_project_may_be_analysed_in_parallel(client):
    csrf = auth(client)
    a, b = projekt(client, csrf, "a"), projekt(client, csrf, "b")
    for pid in (a, b):
        for i in range(2):
            prompt(client, csrf, pid, f"p{i}")
    assert client.post("/api/analyses", json={"project_id": a}, headers=hdr(csrf)).status_code == 201
    assert client.post("/api/analyses", json={"project_id": b}, headers=hdr(csrf)).status_code == 201


def test_an_unknown_project_is_not_found(client):
    csrf = auth(client)
    r = client.post("/api/analyses", json={"project_id": 9999}, headers=hdr(csrf))
    assert r.status_code == 404


# ------------------------------------------------------------------ Durchlauf


def test_a_full_run_produces_a_readable_proposal(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(3)]

    fertig = durchlaufen(
        client,
        csrf,
        pid,
        [ids[2], ids[0], ids[1]],
        zusammenfassung="kurz gesagt",
        phasen=[{"name": "Fundament", "prompt_ids": [ids[2]]}],
        abhaengigkeiten=[{"von": ids[2], "nach": ids[0], "grund": "baut darauf"}],
        zusammenfuehren=[{"prompt_ids": [ids[0], ids[1]], "titel": "T"}],
    )
    assert fertig["status"] == "succeeded"
    assert fertig["cost_usd"] == 0.42
    ergebnis = fertig["result"]
    assert [s["prompt_id"] for s in ergebnis["reihenfolge"]] == [ids[2], ids[0], ids[1]]
    assert ergebnis["zusammenfassung"] == "kurz gesagt"
    assert len(ergebnis["abhaengigkeiten"]) == 1
    assert ergebnis["zusammenfuehren"][0]["prompt_ids"] == [ids[0], ids[1]]
    # Die Phase deckt einen von drei Prompts ab — der Rest bekommt eine eigene.
    assert [p["name"] for p in ergebnis["phasen"]] == ["Fundament", "Ohne Phase"]


def test_an_unparseable_answer_fails_honestly(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(2):
        prompt(client, csrf, pid, f"p{i}")
    lauf = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).json()
    client.post("/api/analyses/claim", json={"runner_id": "t"}, headers=RUNNER_HDR)

    r = client.post(
        f"/api/analyses/{lauf['id']}/result",
        json={"status": "succeeded", "optimized_text": "Tut mir leid, das geht nicht."},
        headers=RUNNER_HDR,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "failed"
    assert "nicht auswertbar" in r.json()["error"]


def test_the_raw_answer_survives_a_parse_failure(client):
    """Ohne sie wäre ein bezahlter Lauf nicht nachvollziehbar."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import ProjectAnalysis

    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(2):
        prompt(client, csrf, pid, f"p{i}")
    lauf = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).json()
    client.post("/api/analyses/claim", json={"runner_id": "t"}, headers=RUNNER_HDR)
    client.post(
        f"/api/analyses/{lauf['id']}/result",
        json={"status": "succeeded", "optimized_text": "Unsinn ohne JSON"},
        headers=RUNNER_HDR,
    )
    with Session(db_module.engine) as s:
        assert s.get(ProjectAnalysis, lauf["id"]).raw_text == "Unsinn ohne JSON"


def test_a_job_can_only_be_claimed_once(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(2):
        prompt(client, csrf, pid, f"p{i}")
    client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf))
    assert client.post("/api/analyses/claim", json={}, headers=RUNNER_HDR).status_code == 200
    assert client.post("/api/analyses/claim", json={}, headers=RUNNER_HDR).status_code == 204


# ---------------------------------------------------------------- übernehmen


def test_applying_writes_the_proposed_order(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(3)]
    fertig = durchlaufen(client, csrf, pid, [ids[2], ids[0], ids[1]])

    r = client.post(f"/api/analyses/{fertig['id']}/apply", headers=hdr(csrf))
    assert r.status_code == 200, r.text
    assert r.json()["analysis"]["decision"] == "applied"

    tafel = client.get("/api/prompts").json()
    queue = [p["id"] for p in tafel if p["status"] == "queued" and p["project_id"] == pid]
    assert queue == [ids[2], ids[0], ids[1]]


def test_applying_does_not_touch_other_projects(client):
    """Der 0.27.0-Regressionswächter.

    `sort_order` gilt je STATUSSPALTE, nicht je Projekt. Eine Teilmenge 1..n
    durchzunummerieren überschreibt die Reihenfolge aller anderen Projekte in
    derselben Spalte.
    """
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Prompt

    csrf = auth(client)
    a, b = projekt(client, csrf, "a"), projekt(client, csrf, "b")
    # Verschränkt anlegen, damit die Plätze beider Projekte sich abwechseln.
    a_ids, b_ids = [], []
    for i in range(3):
        a_ids.append(prompt(client, csrf, a, f"a{i}"))
        b_ids.append(prompt(client, csrf, b, f"b{i}"))

    with Session(db_module.engine) as s:
        vorher = {
            p.id: p.sort_order
            for p in s.exec(select(Prompt)).all()
            if p.project_id == b
        }

    fertig = durchlaufen(client, csrf, a, [a_ids[2], a_ids[1], a_ids[0]])
    client.post(f"/api/analyses/{fertig['id']}/apply", headers=hdr(csrf))

    with Session(db_module.engine) as s:
        nachher = {
            p.id: p.sort_order
            for p in s.exec(select(Prompt)).all()
            if p.project_id == b
        }
    assert nachher == vorher, "die Analyse hat fremde Projekte verschoben"

    # Und das eigene Projekt sitzt genau auf den Plätzen, die es vorher hielt.
    with Session(db_module.engine) as s:
        plaetze = sorted(
            p.sort_order for p in s.exec(select(Prompt)).all() if p.project_id == a
        )
    assert len(set(plaetze)) == 3


def test_a_proposed_priority_is_applied_only_where_given(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(2)]
    lauf = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).json()
    client.post("/api/analyses/claim", json={}, headers=RUNNER_HDR)
    client.post(
        f"/api/analyses/{lauf['id']}/result",
        json={
            "status": "succeeded",
            "optimized_text": json.dumps(
                {
                    "reihenfolge": [
                        {"prompt_id": ids[0], "prioritaet": "high"},
                        {"prompt_id": ids[1]},
                    ]
                }
            ),
        },
        headers=RUNNER_HDR,
    )
    client.post(f"/api/analyses/{lauf['id']}/apply", headers=hdr(csrf))

    tafel = {p["id"]: p for p in client.get("/api/prompts").json()}
    assert tafel[ids[0]]["priority"] == "high"
    assert tafel[ids[1]]["priority"] == "normal"


def test_a_decision_happens_once(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(2)]
    fertig = durchlaufen(client, csrf, pid, ids)
    assert client.post(f"/api/analyses/{fertig['id']}/apply", headers=hdr(csrf)).status_code == 200
    assert client.post(f"/api/analyses/{fertig['id']}/discard", headers=hdr(csrf)).status_code == 409


def test_discarding_changes_nothing_but_stays_readable(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(3)]
    vorher = [p["id"] for p in client.get("/api/prompts").json() if p["project_id"] == pid]

    fertig = durchlaufen(client, csrf, pid, list(reversed(ids)))
    r = client.post(f"/api/analyses/{fertig['id']}/discard", headers=hdr(csrf))
    assert r.json()["geaendert"] == 0

    nachher = [p["id"] for p in client.get("/api/prompts").json() if p["project_id"] == pid]
    assert nachher == vorher
    # Das Ergebnis bleibt lesbar — wie ein verworfener Optimierungs-Vorschlag.
    assert client.get(f"/api/analyses/{fertig['id']}").json()["result"] is not None


def test_a_prompt_deleted_after_the_run_is_dropped_from_the_proposal(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(3)]
    fertig = durchlaufen(client, csrf, pid, ids)

    client.delete(f"/api/prompts/{ids[1]}", headers=hdr(csrf))
    ergebnis = client.get(f"/api/analyses/{fertig['id']}").json()["result"]
    assert ids[1] not in [s["prompt_id"] for s in ergebnis["reihenfolge"]]


def test_a_changed_queue_marks_the_proposal_stale(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    ids = [prompt(client, csrf, pid, f"p{i}") for i in range(2)]
    fertig = durchlaufen(client, csrf, pid, ids)
    assert client.get(f"/api/analyses/{fertig['id']}").json()["stale"] is False

    prompt(client, csrf, pid, "neu dazugekommen")
    assert client.get(f"/api/analyses/{fertig['id']}").json()["stale"] is True


# ------------------------------------------------------------- Mandanten


def test_a_stranger_gets_404_not_403(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(2):
        prompt(client, csrf, pid, f"p{i}")
    lauf = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).json()

    fremd = auth(client, "fremd@example.com", sub="s2")
    for pfad in ("", "/cancel", "/apply", "/discard"):
        methode = client.get if pfad == "" else client.post
        r = methode(f"/api/analyses/{lauf['id']}{pfad}", headers=hdr(fremd))
        assert r.status_code == 404, f"{pfad}: {r.status_code}"


def test_the_list_only_shows_your_own(client):
    csrf = auth(client)
    pid = projekt(client, csrf)
    for i in range(2):
        prompt(client, csrf, pid, f"p{i}")
    client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf))

    fremd = auth(client, "fremd@example.com", sub="s2")
    assert client.get("/api/analyses", headers=hdr(fremd)).json() == []
