"""`Prompt.edited_at` — the timestamp the cards render as "vor 3 Stunden".

The whole point of the column is that it moves on an EDIT and on nothing else.
`updated_at`, the obvious candidate, moves on every write: in production it sat
more than a minute past the last real content change on 221 of 271 prompts (49 %
by more than a day), because a drag, a status change or a "getestet" tick all
bump it. A card announcing "gerade eben" because someone reordered a column is
worse than no timestamp at all — so the negatives below are the real subject of
this file.
"""
from __future__ import annotations

from conftest import auth

HDR = "X-CSRF-Token"


def _mk(client, csrf, **kw) -> dict:
    payload = {"body": "erste Fassung", **kw}
    r = client.post("/api/prompts", json=payload, headers={HDR: csrf})
    assert r.status_code == 201, r.text
    return r.json()


def _get(client, pid: int) -> dict:
    row = next(p for p in client.get("/api/prompts").json() if p["id"] == pid)
    return row


def _patch(client, csrf, pid: int, **body) -> dict:
    r = client.patch(f"/api/prompts/{pid}", json=body, headers={HDR: csrf})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_new_prompt_is_edited_at_its_creation(client):
    csrf = auth(client)
    p = _mk(client, csrf)
    assert p["edited_at"] is not None
    # Same save: the row is written, the event stamped microseconds later.
    assert abs(_secs(p["edited_at"]) - _secs(p["created_at"])) < 2


def _secs(iso: str) -> float:
    from datetime import datetime

    return datetime.fromisoformat(iso).timestamp()


def test_rewriting_the_body_resets_the_age(client):
    csrf = auth(client)
    p = _mk(client, csrf)
    before = p["edited_at"]
    after = _patch(client, csrf, p["id"], body="zweite Fassung")["edited_at"]
    assert after > before


def test_title_tags_and_project_all_count_as_content(client):
    csrf = auth(client)
    project = client.post("/api/projects", json={"name": "P"}, headers={HDR: csrf}).json()
    for change in ({"title": "Neuer Titel"}, {"tags": "api,ui"}, {"project_id": project["id"]}):
        p = _mk(client, csrf)
        before = p["edited_at"]
        assert _patch(client, csrf, p["id"], **change)["edited_at"] > before, change


def test_a_status_change_does_NOT_reset_the_age(client):
    csrf = auth(client)
    p = _mk(client, csrf)
    moved = _patch(client, csrf, p["id"], status="done")
    assert moved["edited_at"] == p["edited_at"]
    # ...while `updated_at` does move — the two are deliberately different.
    assert moved["updated_at"] > p["updated_at"]


def test_toggles_do_NOT_reset_the_age(client):
    csrf = auth(client)
    p = _mk(client, csrf)
    for change in ({"bookmarked": True}, {"blocked": True}, {"blocked": False}):
        assert _patch(client, csrf, p["id"], **change)["edited_at"] == p["edited_at"], change
    done = _patch(client, csrf, p["id"], status="done")
    assert _patch(client, csrf, p["id"], tested=True)["edited_at"] == done["edited_at"]


def test_dragging_does_NOT_reset_the_age(client):
    csrf = auth(client)
    a = _mk(client, csrf, body="a")
    b = _mk(client, csrf, body="b")
    r = client.post(
        f"/api/prompts/{b['id']}/move", json={"before_id": a["id"]}, headers={HDR: csrf}
    )
    assert r.status_code == 200, r.text
    assert _get(client, b["id"])["edited_at"] == b["edited_at"]
    assert _get(client, a["id"])["edited_at"] == a["edited_at"]


def test_moving_a_whole_selection_does_NOT_reset_their_ages(client):
    csrf = auth(client)
    ids = [_mk(client, csrf, body=f"p{i}") for i in range(3)]
    r = client.post(
        "/api/prompts/move",
        json={"ids": [p["id"] for p in ids], "status": "done", "top": True},
        headers={HDR: csrf},
    )
    assert r.status_code == 200, r.text
    for p in ids:
        assert _get(client, p["id"])["edited_at"] == p["edited_at"]


def test_a_saved_edit_that_changed_nothing_leaves_the_age_alone(client):
    """Opening the composer and pressing save must not make a prompt look new."""
    csrf = auth(client)
    p = _mk(client, csrf)
    same = _patch(client, csrf, p["id"], body=p["body"], title=p["title"])
    assert same["edited_at"] == p["edited_at"]


def test_a_duplicate_is_a_new_prompt_and_starts_now(client):
    csrf = auth(client)
    p = _mk(client, csrf)
    copy = client.post(
        f"/api/prompts/{p['id']}/duplicate", json={"in_place": True}, headers={HDR: csrf}
    ).json()
    assert copy["edited_at"] >= p["edited_at"]
    assert copy["id"] != p["id"]


def test_a_merge_result_is_freshly_edited(client):
    csrf = auth(client)
    a, b = _mk(client, csrf, body="a"), _mk(client, csrf, body="b")
    merged = client.post(
        "/api/prompts/merge",
        json={"source_ids": [a["id"], b["id"]], "title": "Zusammen", "body": "a\n\nb",
              "originals": "keep"},
        headers={HDR: csrf},
    ).json()
    assert merged["edited_at"] is not None
    assert merged["edited_at"] >= a["edited_at"]
    # The sources were not edited by being merged.
    assert _get(client, a["id"])["edited_at"] == a["edited_at"]


def test_archiving_the_sources_of_a_merge_is_not_an_edit(client):
    csrf = auth(client)
    a, b = _mk(client, csrf, body="a"), _mk(client, csrf, body="b")
    client.post(
        "/api/prompts/merge",
        json={"source_ids": [a["id"], b["id"]], "title": "Z", "body": "z",
              "originals": "archive"},
        headers={HDR: csrf},
    )
    assert _get(client, a["id"])["edited_at"] == a["edited_at"]


def test_every_content_event_moves_it_and_no_other_one_does(client):
    """The invariant itself: `edited_at` follows the activity log exactly.

    Both answer "when was this content last written", and `events.record()` is
    the single writer of both — this pins that they cannot drift apart.
    """
    import app.db as db_module
    from sqlmodel import Session

    from app import events
    from app.models import Prompt, PromptEventType

    csrf = auth(client)
    p = _mk(client, csrf)
    with Session(db_module.engine) as s:
        row = s.get(Prompt, p["id"])
        for event, moves in (
            (PromptEventType.created, True),
            (PromptEventType.updated, True),
            (PromptEventType.status_changed, False),
            (PromptEventType.deleted, False),
        ):
            before = row.edited_at
            events.record(s, row, event)
            assert (row.edited_at != before) is moves, event


def test_applying_an_optimization_counts_as_an_edit(client):
    """Accepting a rewrite replaces the body — the card must say "gerade eben"."""
    from conftest import RUNNER_HDR

    csrf = auth(client)
    headers = {HDR: csrf}
    p = _mk(client, csrf)
    job = client.post("/api/optimizations", json={"prompt_id": p["id"]}, headers=headers).json()
    client.post("/api/optimizations/claim", json={"runner_id": "r"}, headers=RUNNER_HDR)
    client.post(
        f"/api/optimizations/{job['id']}/result",
        json={"status": "succeeded", "optimized_text": "Bessere Fassung", "exit_code": 0},
        headers=RUNNER_HDR,
    )
    # A pending proposal has not changed anything yet.
    assert _get(client, p["id"])["edited_at"] == p["edited_at"]

    applied = client.post(f"/api/optimizations/{job['id']}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    assert applied.json()["prompt"]["edited_at"] > p["edited_at"]


def test_discarding_an_optimization_is_not_an_edit(client):
    from conftest import RUNNER_HDR

    csrf = auth(client)
    headers = {HDR: csrf}
    p = _mk(client, csrf)
    job = client.post("/api/optimizations", json={"prompt_id": p["id"]}, headers=headers).json()
    client.post("/api/optimizations/claim", json={"runner_id": "r"}, headers=RUNNER_HDR)
    client.post(
        f"/api/optimizations/{job['id']}/result",
        json={"status": "succeeded", "optimized_text": "x", "exit_code": 0},
        headers=RUNNER_HDR,
    )
    client.post(f"/api/optimizations/{job['id']}/discard", headers=headers)
    assert _get(client, p["id"])["edited_at"] == p["edited_at"]
