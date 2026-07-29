"""Long polling on the runner's claim endpoints (app/longpoll.py).

The point of the feature is traffic, but the property worth pinning down is
that it costs nothing in latency or semantics: an empty queue still answers
204, work already there still comes back at once, and work that shows up WHILE
a request is open is picked up without the runner asking again.
"""
from __future__ import annotations

import threading
import time

import pytest  # noqa: F401  (fixtures come from conftest)

from conftest import RUNNER_HDR as _RUNNER_HDR
from conftest import auth as _auth


def _mk_run(client, headers) -> str:
    pid = client.post("/api/prompts", json={"body": "do the thing"}, headers=headers).json()["id"]
    r = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------- pure budget


def test_budget_is_clamped_into_range():
    from app.longpoll import MAX_WAIT_S, budget_for

    assert budget_for(None) == 0.0
    assert budget_for(0) == 0.0
    assert budget_for(-5) == 0.0
    assert budget_for(3.5) == 3.5
    # A client asking for more than the ceiling must not be able to park a
    # request past the reverse proxy's read timeout.
    assert budget_for(600) == MAX_WAIT_S
    assert MAX_WAIT_S < 60, "must stay below the nginx proxy_read_timeout of 60 s"


# ------------------------------------------------------------ empty vs. ready


def test_waiting_on_an_empty_queue_still_answers_204(client):
    _auth(client)
    started = time.monotonic()
    r = client.post("/api/runs/claim", json={"runner_id": "r1"}, params={"wait": 1}, headers=_RUNNER_HDR)
    elapsed = time.monotonic() - started
    assert r.status_code == 204
    # It really waited (rather than falling through) but respected the budget.
    assert 0.5 <= elapsed < 6, elapsed


def test_work_already_queued_returns_at_once_despite_a_long_wait(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    run_id = _mk_run(client, headers)

    started = time.monotonic()
    r = client.post(
        "/api/runs/claim", json={"runner_id": "r1"}, params={"wait": 20}, headers=_RUNNER_HDR
    )
    elapsed = time.monotonic() - started
    assert r.status_code == 200, r.text
    assert r.json()["id"] == run_id
    assert elapsed < 2, f"a ready run must not wait out the budget ({elapsed:.1f}s)"


def test_work_arriving_during_the_wait_is_picked_up(client):
    """The whole reason long polling is not just a slower poll."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}

    def enqueue_soon():
        time.sleep(0.4)
        _mk_run(client, headers)

    t = threading.Thread(target=enqueue_soon)
    t.start()
    try:
        started = time.monotonic()
        r = client.post(
            "/api/runs/claim", json={"runner_id": "r1"}, params={"wait": 15}, headers=_RUNNER_HDR
        )
        elapsed = time.monotonic() - started
    finally:
        t.join()

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "claiming"
    # Picked up on a server-side re-check, well inside the budget.
    assert elapsed < 8, f"took {elapsed:.1f}s to notice queued work"


# ------------------------------------------------- same contract on all three


def test_every_claim_endpoint_accepts_a_wait(client):
    _auth(client)
    started = time.monotonic()
    assert (
        client.get("/api/cli/claim", params={"wait": 1}, headers=_RUNNER_HDR).status_code == 204
    )
    assert (
        client.post(
            "/api/optimizations/claim",
            json={"runner_id": "r1"},
            params={"wait": 1},
            headers=_RUNNER_HDR,
        ).status_code
        == 204
    )
    # Both waited rather than erroring out on an unknown query param.
    assert time.monotonic() - started >= 1.0


def test_without_wait_the_endpoints_answer_immediately(client):
    """The default stays a single attempt — an older runner keeps working."""
    _auth(client)
    started = time.monotonic()
    assert client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).status_code == 204
    assert client.get("/api/cli/claim", headers=_RUNNER_HDR).status_code == 204
    assert (
        client.post("/api/optimizations/claim", json={}, headers=_RUNNER_HDR).status_code == 204
    )
    assert time.monotonic() - started < 1.0


def test_waiting_holds_no_pooled_connection(client):
    """A parked long poll must own no DB connection.

    This is why `claim_with_wait` opens a fresh session per attempt instead of
    keeping one for the request: the pool holds five connections, so a few idle
    runners sitting on one each for 25 s at a time would take the pool away from
    everything else. Sampled between two re-checks, mid-wait.
    """
    import asyncio

    from app import db, longpoll

    checked_out: list[int] = []

    def never_finds_work(_session):
        return None

    async def scenario():
        task = asyncio.create_task(longpoll.claim_with_wait(never_finds_work, wait=2))
        await asyncio.sleep(1.5)  # ticks land at 1.0/2.0 — this is between them
        checked_out.append(db.engine.pool.checkedout())
        return await task

    assert asyncio.run(scenario()) is None
    assert checked_out == [0], f"held {checked_out[0]} connection(s) while idling"


def test_normal_requests_are_served_while_long_polls_are_parked(client):
    csrf = _auth(client)
    done: list[int] = []

    def poll():
        r = client.post(
            "/api/runs/claim", json={"runner_id": "r1"}, params={"wait": 3}, headers=_RUNNER_HDR
        )
        done.append(r.status_code)

    waiters = [threading.Thread(target=poll) for _ in range(3)]
    for t in waiters:
        t.start()
    try:
        time.sleep(0.3)  # let them all be parked in their wait
        started = time.monotonic()
        r = client.get("/api/prompts", headers={"X-CSRF-Token": csrf})
        elapsed = time.monotonic() - started
        assert r.status_code == 200
        assert elapsed < 2, f"a normal request queued behind the long polls ({elapsed:.1f}s)"
    finally:
        for t in waiters:
            t.join()
    assert done == [204, 204, 204]
