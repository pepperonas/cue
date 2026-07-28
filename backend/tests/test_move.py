"""Anchored moves: ordering must stay correct even when the client sees a subset.

Regression: the board numbered the cards it could SEE 1..n and sent that, so a
drag with a project filter active collided with the prompts it had filtered out
(production had 14 prompts sharing sort_order 1 in "done").
"""
from __future__ import annotations

from conftest import auth as _auth

from app.ordering import insert_at


def _mk(client, headers, body, **extra):
    res = client.post("/api/prompts", json={"body": body, **extra}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _project(client, headers, name):
    res = client.post("/api/projects", json={"name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _column(client, headers, status="queued"):
    rows = client.get("/api/prompts", headers=headers, params={"status": status}).json()
    rows.sort(key=lambda p: (p["sort_order"], p["id"]))
    return rows


def _move(client, headers, prompt_id, **payload):
    res = client.post(f"/api/prompts/{prompt_id}/move", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ------------------------------------------------------------------ unit level


def test_insert_at_places_before_and_after_an_anchor():
    assert insert_at([1, 2, 3], 9, before_id=2) == [1, 9, 2, 3]
    assert insert_at([1, 2, 3], 9, after_id=2) == [1, 2, 9, 3]


def test_insert_at_falls_back_to_top_or_end_without_an_anchor():
    assert insert_at([1, 2, 3], 9) == [1, 2, 3, 9]
    assert insert_at([1, 2, 3], 9, top=True) == [9, 1, 2, 3]


def test_insert_at_ignores_an_anchor_that_is_no_longer_there():
    # Concurrent change: better a column edge than a drag that bounces back.
    assert insert_at([1, 2, 3], 9, before_id=42) == [1, 2, 3, 9]
    assert insert_at([1, 2, 3], 9, before_id=42, top=True) == [9, 1, 2, 3]


def test_insert_at_moves_a_prompt_that_is_already_in_the_list():
    assert insert_at([1, 2, 3], 3, before_id=1) == [3, 1, 2]


def test_insert_at_prefers_before_over_after():
    assert insert_at([1, 2, 3], 9, before_id=1, after_id=3) == [9, 1, 2, 3]


# ------------------------------------------------------------------- endpoint


def test_move_renumbers_the_whole_column_without_collisions(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a, b, c = (_mk(client, headers, f"Prompt {n}") for n in "ABC")

    _move(client, headers, c["id"], before_id=a["id"])

    column = _column(client, headers)
    assert [p["body"] for p in column] == ["Prompt C", "Prompt A", "Prompt B"]
    assert [p["sort_order"] for p in column] == [1, 2, 3]


def test_move_keeps_prompts_of_other_projects_in_order(client):
    """The bug: a filtered client renumbered only what it could see."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    one = _project(client, headers, "eins")
    two = _project(client, headers, "zwei")
    # Interleaved, so a subset-only renumbering would be visible immediately.
    a1 = _mk(client, headers, "A1", project_id=one["id"])
    b1 = _mk(client, headers, "B1", project_id=two["id"])
    a2 = _mk(client, headers, "A2", project_id=one["id"])
    b2 = _mk(client, headers, "B2", project_id=two["id"])

    # A client filtered to project "eins" only sees A1, A2 and moves A2 above A1.
    _move(client, headers, a2["id"], before_id=a1["id"])

    column = _column(client, headers)
    orders = [p["sort_order"] for p in column]
    assert orders == sorted(set(orders)) == [1, 2, 3, 4]  # dense and collision-free
    bodies = [p["body"] for p in column]
    assert bodies.index("A2") < bodies.index("A1")  # the requested move happened
    assert bodies.index("B1") < bodies.index("B2")  # the hidden ones kept their order


def test_move_across_columns_applies_the_status_side_effects(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Wandert nach done")

    _move(client, headers, prompt["id"], status="done", top=True)

    moved = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert moved["status"] == "done"
    assert moved["ran_at"] is not None
    assert moved["sort_order"] == 1
    assert _column(client, headers, "queued") == []


def test_move_clears_tested_when_leaving_done(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Getestet und zurück", status="done")
    client.patch(f"/api/prompts/{prompt['id']}", json={"tested": True}, headers=headers)

    _move(client, headers, prompt["id"], status="queued")

    assert client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()["tested"] is False


def test_move_rejects_running_a_blocked_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Blockiert")
    client.patch(f"/api/prompts/{prompt['id']}", json={"blocked": True}, headers=headers)

    res = client.post(
        f"/api/prompts/{prompt['id']}/move", json={"status": "done"}, headers=headers
    )
    assert res.status_code == 400


def test_move_does_not_touch_another_tenants_prompt(client):
    csrf = _auth(client, "owner@example.com")
    mine = _mk(client, {"X-CSRF-Token": csrf}, "Meiner")
    other_csrf = _auth(client, "someone@example.com", sub="other-sub")

    res = client.post(
        f"/api/prompts/{mine['id']}/move",
        json={"top": True},
        headers={"X-CSRF-Token": other_csrf},
    )
    assert res.status_code == 404


def test_bookmark_move_renumbers_the_section(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    ids = []
    for name in "ABC":
        p = _mk(client, headers, f"Bookmark {name}")
        client.patch(f"/api/prompts/{p['id']}", json={"bookmarked": True}, headers=headers)
        ids.append(p["id"])

    res = client.post(
        f"/api/prompts/{ids[2]}/bookmarks/move", json={"before_id": ids[0]}, headers=headers
    )
    assert res.status_code == 200, res.text
    section = res.json()
    assert [p["id"] for p in section] == [ids[2], ids[0], ids[1]]
    assert [p["bookmark_order"] for p in section] == [1, 2, 3]


def test_repair_migration_densifies_the_collisions_the_old_client_left(client):
    """Startup repair for the data the filtered-drag bug produced."""
    from sqlalchemy import text

    from app import db as db_module

    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    ids = [_mk(client, headers, f"P{i}")["id"] for i in range(4)]

    with db_module.engine.begin() as conn:
        # Two projects, each numbered 1..n inside the same column — exactly what
        # a board filtered to one project used to write.
        for prompt_id, order in zip(ids, [1, 2, 1, 2]):
            conn.execute(
                text("UPDATE prompt SET sort_order = :o WHERE id = :id"),
                {"o": order, "id": prompt_id},
            )
        display_order = [
            row[0]
            for row in conn.execute(
                text("SELECT id FROM prompt WHERE status='queued' ORDER BY sort_order, id")
            )
        ]

        db_module._repair_sort_order(conn)
        repaired = conn.execute(
            text("SELECT id, sort_order FROM prompt WHERE status='queued' ORDER BY sort_order, id")
        ).fetchall()

        assert [row[0] for row in repaired] == display_order  # nothing visibly jumps
        assert [row[1] for row in repaired] == [1, 2, 3, 4]  # dense, collision-free

        # Idempotent: a second pass is a no-op.
        db_module._repair_sort_order(conn)
        again = conn.execute(
            text("SELECT id, sort_order FROM prompt WHERE status='queued' ORDER BY sort_order, id")
        ).fetchall()
        assert again == repaired


def test_bookmark_move_requires_a_bookmarked_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Kein Bookmark")
    res = client.post(
        f"/api/prompts/{prompt['id']}/bookmarks/move", json={"top": True}, headers=headers
    )
    assert res.status_code == 400
