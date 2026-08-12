"""The cross-device change feed (app/changes.py + routers/changes.py).

What has to hold, in order of how badly it breaks the feature when it doesn't:

1. Every kind of mutation moves the fingerprint. A change the feed cannot see
   is a change the other device never learns about — silently, forever.
2. A change reports the entity it actually touched, and no others.
3. Tenants are separated. Another account's writes must not wake my poll (they
   would hand it a cursor that hides my own next change).
4. The wait costs no database connection and no correctness.
"""
from __future__ import annotations

import threading
import time

from conftest import auth as _auth
from conftest import make_user


def _cursor(client, headers=None) -> str:
    r = client.get("/api/changes", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()["cursor"]


def _poll(client, cursor: str, wait: float = 0):
    return client.get("/api/changes", params={"since": cursor, "wait": wait})


# ------------------------------------------------------------ cursor plumbing


def test_cursor_round_trips_and_unknown_input_means_everything_changed():
    """An unparseable cursor must read as "refetch", never as an error.

    A client left on an older build would otherwise be stuck with a feed that
    rejects it, which is the one failure mode worse than refetching once.
    """
    from app import changes

    parts = {k: f"v{i}" for i, k in enumerate(changes.ENTITIES)}
    assert changes.decode(changes.encode(parts)) == parts

    assert changes.decode(None) == {}
    assert changes.decode("") == {}
    assert changes.decode("garbage-without-separators") == {}
    assert changes.decode("nosuchentity:1") == {}
    # ...and an empty "before" reports every entity as changed.
    assert changes.changed({}, parts) == list(changes.ENTITIES)


def test_a_timestamp_inside_a_part_survives_the_round_trip():
    """`_stamped` embeds an ISO timestamp, which contains the field separator."""
    from app import changes

    parts = {changes.PROMPTS: "3.9.2026-08-12 16:39:11.285795"}
    assert changes.decode(changes.encode(parts)) == parts


def test_changed_lists_only_what_moved_in_a_stable_order():
    from app import changes

    before = {k: "same" for k in changes.ENTITIES}
    now = dict(before, snippets="new", prompts="new")
    assert changes.changed(before, now) == [changes.PROMPTS, changes.SNIPPETS]
    assert changes.changed(before, before) == []


# ------------------------------------------------- every mutation is observed


def test_first_call_hands_out_a_cursor_without_claiming_anything_changed(client):
    """The client has just loaded its lists; making it reload them is waste."""
    _auth(client)
    r = client.get("/api/changes")
    assert r.status_code == 200
    assert r.json()["changed"] == []
    assert r.json()["cursor"]


def test_creating_a_prompt_moves_only_the_prompt_marker(client):
    csrf = _auth(client)
    before = _cursor(client)
    client.post("/api/prompts", json={"body": "vom Telefon"}, headers={"X-CSRF-Token": csrf})

    body = _poll(client, before).json()
    assert body["changed"] == ["prompts"]
    assert body["cursor"] != before


def test_editing_deleting_and_moving_a_prompt_are_all_visible(client):
    """Three shapes of change, three chances for a fingerprint to miss one.

    Editing keeps the row count and the highest id identical, so only the
    timestamp catches it; deleting the newest prompt moves the count back.
    """
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    first = client.post("/api/prompts", json={"body": "eins"}, headers=hdr).json()
    second = client.post("/api/prompts", json={"body": "zwei"}, headers=hdr).json()

    cursor = _cursor(client)
    client.patch(f"/api/prompts/{first['id']}", json={"body": "eins, bearbeitet"}, headers=hdr)
    body = _poll(client, cursor).json()
    assert body["changed"] == ["prompts"], "an edit left the fingerprint untouched"

    cursor = body["cursor"]
    r = client.post(
        f"/api/prompts/{second['id']}/move", json={"status": "running", "top": True}, headers=hdr
    )
    assert r.status_code == 200, r.text
    body = _poll(client, cursor).json()
    assert body["changed"] == ["prompts"], "a drag left the fingerprint untouched"

    cursor = body["cursor"]
    client.delete(f"/api/prompts/{second['id']}", headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["prompts"]


def test_renaming_a_project_is_visible_although_it_has_no_updated_at(client):
    """The exact case a `max(updated_at)` fingerprint would sleep through."""
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    pid = client.post("/api/projects", json={"name": "alt", "color": "#123456"}, headers=hdr).json()[
        "id"
    ]

    cursor = _cursor(client)
    client.patch(f"/api/projects/{pid}", json={"name": "neu"}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["projects"]

    cursor = _cursor(client)
    client.patch(f"/api/projects/{pid}", json={"color": "#abcdef"}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["projects"], "a recolour went unnoticed"


def test_reordering_projects_is_visible(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    a = client.post("/api/projects", json={"name": "a"}, headers=hdr).json()
    b = client.post("/api/projects", json={"name": "b"}, headers=hdr).json()

    cursor = _cursor(client)
    r = client.post(
        "/api/projects/reorder",
        json={"items": [{"id": b["id"], "sort_order": 0}, {"id": a["id"], "sort_order": 1}]},
        headers=hdr,
    )
    assert r.status_code in (200, 204), r.text
    assert _poll(client, cursor).json()["changed"] == ["projects"]


def test_a_snippet_and_its_group_share_one_marker(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}

    cursor = _cursor(client)
    client.post("/api/snippets", json={"abbreviation": ";sig", "body": "Gruß"}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["snippets"]

    cursor = _cursor(client)
    client.post("/api/snippets/groups", json={"name": "Bausteine"}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["snippets"], "an empty group went unnoticed"


def test_a_captured_prompt_shows_up_in_the_history_marker(client):
    """The Verlauf tab's data arrives from outside the browser entirely."""
    from conftest import CAPTURE_HDR

    _auth(client)
    cursor = _cursor(client)
    r = client.post(
        "/api/capture",
        json={
            "items": [
                {
                    "session_id": "abc-123",
                    "cwd": "/Users/martin/claude/cue",
                    "prompt": "was macht der Cursor",
                    "seq": 1,
                }
            ]
        },
        headers=CAPTURE_HDR,
    )
    assert r.status_code in (200, 201, 204), r.text
    # Capture derives the project from the cwd and creates it on the way in, so
    # both markers legitimately move — the client needs to hear about both.
    assert _poll(client, cursor).json()["changed"] == ["projects", "sessions"]


def test_renaming_a_tag_moves_the_tag_marker(client):
    """The rename rewrites the cached tag strings on every prompt, so the
    client has to reload the prompts too — that mapping lives on the frontend
    (`INVALIDATIONS`), which is why this only has to report the tag."""
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    client.post("/api/prompts", json={"body": "x", "tags": "feature"}, headers=hdr)
    tag_id = client.get("/api/tags").json()["items"][0]["id"]

    cursor = _cursor(client)
    r = client.patch(f"/api/tags/{tag_id}", json={"name": "Feature"}, headers=hdr)
    assert r.status_code == 200, r.text
    assert "tags" in _poll(client, cursor).json()["changed"]


def test_bookmarking_and_blocking_are_visible(client):
    """Both are plain prompt edits — the point is that the flags travel too,
    since the bookmarks tab on the other device is driven by them."""
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    pid = client.post("/api/prompts", json={"body": "merken"}, headers=hdr).json()["id"]

    cursor = _cursor(client)
    client.patch(f"/api/prompts/{pid}", json={"bookmarked": True}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["prompts"]

    cursor = _cursor(client)
    client.patch(f"/api/prompts/{pid}", json={"blocked": True}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["prompts"]


def test_moving_a_prompt_to_another_project_is_visible(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    proj = client.post("/api/projects", json={"name": "ziel"}, headers=hdr).json()
    pid = client.post("/api/prompts", json={"body": "umziehen"}, headers=hdr).json()["id"]

    cursor = _cursor(client)
    client.patch(f"/api/prompts/{pid}", json={"project_id": proj["id"]}, headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["prompts"]


def test_deleting_a_snippet_and_renaming_its_group_are_visible(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    group = client.post("/api/snippets/groups", json={"name": "alt"}, headers=hdr).json()
    sid = client.post(
        "/api/snippets", json={"abbreviation": ";x", "body": "y", "group_name": "alt"}, headers=hdr
    ).json()["id"]

    cursor = _cursor(client)
    r = client.patch(f"/api/snippets/groups/{group['id']}", json={"name": "neu"}, headers=hdr)
    assert r.status_code == 200, r.text
    assert _poll(client, cursor).json()["changed"] == ["snippets"], "a group rename went unnoticed"

    cursor = _cursor(client)
    client.delete(f"/api/snippets/{sid}", headers=hdr)
    assert _poll(client, cursor).json()["changed"] == ["snippets"]


def test_merging_prompts_is_visible(client):
    """One request that creates a row and deletes two others."""
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    a = client.post("/api/prompts", json={"body": "eins"}, headers=hdr).json()
    b = client.post("/api/prompts", json={"body": "zwei"}, headers=hdr).json()

    cursor = _cursor(client)
    r = client.post(
        "/api/prompts/merge",
        json={"source_ids": [a["id"], b["id"]], "title": "beides", "body": "eins\n\nzwei"},
        headers=hdr,
    )
    assert r.status_code in (200, 201), r.text
    assert _poll(client, cursor).json()["changed"] == ["prompts"]


def test_an_idle_tenant_produces_a_stable_cursor(client):
    """Any jitter here — a timestamp read differently, a set iterated in a new
    order — would make every client refetch everything, every second."""
    _auth(client)
    first = _cursor(client)
    for _ in range(3):
        assert _cursor(client) == first

    from sqlmodel import Session, select

    import app.db as db_module
    from app import changes
    from app.models import User

    with Session(db_module.engine) as s:
        uid = s.exec(select(User)).first().id
        assert changes.fingerprint(s, uid) == changes.fingerprint(s, uid)


def test_the_entity_names_are_the_wire_format(client):
    """These strings are what the frontend maps to query keys. Renaming one
    here stops those updates silently — the mirror of this assertion lives in
    `frontend/src/lib/live-sync.test.ts`."""
    from app import changes

    assert sorted(changes.ENTITIES) == ["projects", "prompts", "sessions", "snippets", "tags"]


# ------------------------------------------------------------------- tenancy


def test_another_tenants_write_does_not_wake_my_poll(client):
    """Worse than a missed update: a cursor advanced by someone else's write
    would swallow my own next change."""
    csrf = _auth(client, email="a@example.com", sub="sub-a")
    cursor = _cursor(client)

    # A second account writes directly (its own session cookie would replace ours).
    from sqlmodel import Session

    import app.db as db_module
    from app.models import Prompt

    other = make_user("b@example.com", sub="sub-b")
    with Session(db_module.engine) as s:
        s.add(Prompt(user_id=other, body="fremd"))
        s.commit()

    body = _poll(client, cursor).json()
    assert body["changed"] == []
    assert body["cursor"] == cursor

    # ...and my own write still registers afterwards.
    client.post("/api/prompts", json={"body": "meins"}, headers={"X-CSRF-Token": csrf})
    assert _poll(client, cursor).json()["changed"] == ["prompts"]


def test_the_feed_requires_a_session(client):
    assert client.get("/api/changes").status_code == 401


def test_a_revoked_approval_ends_the_poll(client):
    """Checked inside every attempt, so a parked poll stops on the next tick."""
    _auth(client)
    cursor = _cursor(client)

    from sqlmodel import Session, select

    import app.db as db_module
    from app.models import User

    with Session(db_module.engine) as s:
        user = s.exec(select(User)).first()
        user.approved = False
        s.add(user)
        s.commit()

    assert _poll(client, cursor, wait=2).status_code == 403


# ---------------------------------------------------------------- long poll


def test_a_change_during_the_wait_is_picked_up_without_asking_again(client):
    csrf = _auth(client)
    cursor = _cursor(client)
    answer: list[dict] = []

    def wait_for_it():
        answer.append(_poll(client, cursor, wait=10).json())

    waiter = threading.Thread(target=wait_for_it)
    waiter.start()
    try:
        time.sleep(0.4)  # let it park
        client.post("/api/prompts", json={"body": "spät"}, headers={"X-CSRF-Token": csrf})
    finally:
        waiter.join(timeout=12)

    assert answer and answer[0]["changed"] == ["prompts"]


def test_an_expired_budget_answers_with_the_cursor_unchanged(client):
    """So the client can go straight back into the next wait."""
    _auth(client)
    cursor = _cursor(client)

    started = time.monotonic()
    body = _poll(client, cursor, wait=2).json()
    elapsed = time.monotonic() - started

    assert body == {"cursor": cursor, "changed": []}
    assert 1.5 <= elapsed < 8, f"answered after {elapsed:.1f}s"


def test_waiting_for_changes_holds_no_pooled_connection(client):
    """Browsers park these, several per user — the pool holds five.

    `routers/changes.py` therefore authenticates from the signed cookie alone
    and lets each attempt open its own session.
    """
    import asyncio

    from app import changes as changes_mod
    from app import db
    from app.routers import changes as router

    _auth(client)
    from sqlmodel import Session, select

    from app.models import User

    with Session(db.engine) as s:
        uid = s.exec(select(User)).first().id
        before = changes_mod.fingerprint(s, uid)

    sampled: list[int] = []

    async def scenario():
        from app.longpoll import claim_with_wait

        task = asyncio.create_task(claim_with_wait(router._look(uid, before), wait=2))
        await asyncio.sleep(1.5)  # between two ticks
        sampled.append(db.engine.pool.checkedout())
        return await task

    assert asyncio.run(scenario()) is None
    assert sampled == [0], f"held {sampled[0]} connection(s) while idling"
