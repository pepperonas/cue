"""Smoke tests for the core flows: auth -> CRUD -> reorder -> import -> export."""
from __future__ import annotations

import io
import os

os.environ["SECRET_KEY"] = "test-secret-key-please-change"
os.environ["COOKIE_SECURE"] = "false"
os.environ["CUE_DEV"] = "1"
os.environ["DB_PATH"] = "data/test-cue.db"
# Run engine config (owner-only run feature + runner token + path whitelist).
os.environ["OWNER_EMAIL"] = "owner@example.com"
os.environ["RUNNER_TOKEN"] = "test-runner-token"
os.environ["ALLOWED_PROJECT_BASES"] = "/Users/martin/claude"
os.environ["CAPTURE_TOKEN"] = "test-capture-token"
os.environ["CAPTURE_BASE"] = "/Users/martin/claude"

_RUNNER_HDR = {"Authorization": "Bearer test-runner-token"}
_CAPTURE_HDR = {"Authorization": "Bearer test-capture-token"}

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    os.environ["DB_PATH"] = str(tmp_path / "cue.db")
    os.environ["UPLOAD_DIR"] = str(tmp_path / "uploads")
    os.environ["ATTACHMENTS_DIR"] = str(tmp_path / "attachments")
    # Clear cached settings/engine so the tmp DB is used.
    import importlib

    from app import config

    config.get_settings.cache_clear()
    import app.db as db_module

    importlib.reload(db_module)
    import app.main as main_module

    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c


def _make_user(email: str = "owner@example.com", sub: str | None = None) -> int:
    """Create a user directly and return its id (OAuth is mocked out in tests)."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import User

    with Session(db_module.engine) as s:
        user = User(google_sub=sub or f"sub-{email}", email=email, name="Test")
        s.add(user)
        s.commit()
        s.refresh(user)
        return user.id


def _auth(client, email: str = "owner@example.com", sub: str | None = None) -> str:
    """Mint a session cookie for a user and return the CSRF token."""
    from app import security

    uid = _make_user(email, sub)
    token = security.issue_session(uid)
    client.cookies.set("cue_session", token)
    return security.csrf_from_session(token)


def _login(client) -> str:
    return _auth(client)


def test_login_required(client):
    assert client.get("/api/prompts").status_code == 401


def test_full_flow(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    # Create a project.
    pr = client.post("/api/projects", json={"name": "inspector-rust", "color": "#6750A4"}, headers=headers)
    assert pr.status_code == 201, pr.text
    project_id = pr.json()["id"]

    # Create a prompt (title derived from body).
    cp = client.post(
        "/api/prompts",
        json={"body": "# Fix the parser\nMake it handle edge cases.", "project_id": project_id},
        headers=headers,
    )
    assert cp.status_code == 201, cp.text
    prompt = cp.json()
    assert prompt["title"] == "Fix the parser"
    assert prompt["status"] == "queued"
    pid = prompt["id"]

    # Move to running via reorder -> ran_at gets stamped.
    rr = client.post(
        "/api/prompts/reorder",
        json={"items": [{"id": pid, "status": "running", "sort_order": 1}]},
        headers=headers,
    )
    assert rr.status_code == 200, rr.text
    assert rr.json()[0]["ran_at"] is not None

    # Mark the feature as tested.
    tj = client.patch(f"/api/prompts/{pid}", json={"tested": True}, headers=headers)
    assert tj.status_code == 200, tj.text
    assert tj.json()["tested"] is True

    # Search filter.
    found = client.get("/api/prompts", params={"q": "parser"})
    assert found.status_code == 200
    assert len(found.json()) == 1

    # CSRF is enforced.
    no_csrf = client.post("/api/prompts", json={"body": "x"})
    assert no_csrf.status_code == 403


def test_bookmark_flow(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    ids = []
    for i in range(3):
        cp = client.post("/api/prompts", json={"body": f"Prompt {i}"}, headers=headers)
        assert cp.status_code == 201, cp.text
        body = cp.json()
        assert body["bookmarked"] is False
        assert body["bookmark_order"] == 0
        ids.append(body["id"])

    # Bookmark two prompts -> they get incrementing bookmark_order.
    b0 = client.patch(f"/api/prompts/{ids[0]}", json={"bookmarked": True}, headers=headers)
    b1 = client.patch(f"/api/prompts/{ids[1]}", json={"bookmarked": True}, headers=headers)
    assert b0.json()["bookmarked"] is True
    assert b0.json()["bookmark_order"] == 1
    assert b1.json()["bookmark_order"] == 2

    # Reorder the bookmarks section (swap order).
    rr = client.post(
        "/api/prompts/bookmarks/reorder",
        json={"items": [{"id": ids[1], "bookmark_order": 1}, {"id": ids[0], "bookmark_order": 2}]},
        headers=headers,
    )
    assert rr.status_code == 200, rr.text
    orders = {row["id"]: row["bookmark_order"] for row in rr.json()}
    assert orders[ids[1]] == 1 and orders[ids[0]] == 2

    # Un-bookmark.
    ub = client.patch(f"/api/prompts/{ids[0]}", json={"bookmarked": False}, headers=headers)
    assert ub.json()["bookmarked"] is False


def test_merge_flow(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    ids = []
    for i in range(3):
        cp = client.post("/api/prompts", json={"body": f"Body {i}"}, headers=headers)
        assert cp.status_code == 201, cp.text
        ids.append(cp.json()["id"])

    # Merge the first two, deleting the originals.
    mr = client.post(
        "/api/prompts/merge",
        json={
            "source_ids": [ids[0], ids[1]],
            "title": "Merged",
            "body": "## A\n\nBody 0\n\n---\n\n## B\n\nBody 1",
            "tags": "merged",
            "originals": "delete",
        },
        headers=headers,
    )
    assert mr.status_code == 201, mr.text
    assert mr.json()["title"] == "Merged"

    # Originals gone, third prompt + the merged one remain.
    remaining = {p["id"] for p in client.get("/api/prompts").json()}
    assert ids[0] not in remaining and ids[1] not in remaining
    assert ids[2] in remaining
    assert len(remaining) == 2

    # Fewer than two sources is rejected.
    bad = client.post(
        "/api/prompts/merge",
        json={"source_ids": [ids[2]], "body": "x", "originals": "keep"},
        headers=headers,
    )
    assert bad.status_code == 400


_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_attachment_flow(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    up = client.post(
        "/api/attachments",
        files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
        headers=headers,
    )
    assert up.status_code == 201, up.text
    aid = up.json()["id"]

    # Non-image is rejected.
    bad = client.post(
        "/api/attachments",
        files={"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")},
        headers=headers,
    )
    assert bad.status_code == 400

    # Attach to a new prompt.
    cp = client.post(
        "/api/prompts", json={"body": "with screenshot", "attachment_ids": [aid]}, headers=headers
    )
    assert cp.status_code == 201, cp.text
    pid = cp.json()["id"]
    assert len(cp.json()["attachments"]) == 1
    assert cp.json()["attachments"][0]["url"] == f"/api/attachments/{aid}"

    # The file is served back intact.
    served = client.get(f"/api/attachments/{aid}")
    assert served.status_code == 200 and served.content == _PNG

    # Deleting the prompt purges its attachments.
    assert client.delete(f"/api/prompts/{pid}", headers=headers).status_code == 204
    assert client.get(f"/api/attachments/{aid}").status_code == 404


def test_duplicate_prompt_to_project(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    target = client.post("/api/projects", json={"name": "ziel", "color": "#2E7D55"}, headers=headers)
    assert target.status_code == 201
    target_id = target.json()["id"]

    up = client.post(
        "/api/attachments",
        files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
        headers=headers,
    )
    aid = up.json()["id"]
    src = client.post(
        "/api/prompts",
        json={"title": "Voice", "body": "voice input", "tags": "audio, ux",
              "status": "done", "attachment_ids": [aid]},
        headers=headers,
    ).json()

    dup = client.post(
        f"/api/prompts/{src['id']}/duplicate", json={"project_id": target_id}, headers=headers
    )
    assert dup.status_code == 201, dup.text
    copy = dup.json()
    assert copy["id"] != src["id"]
    assert copy["title"] == "Voice" and copy["body"] == "voice input"
    assert copy["tags"] == "audio, ux"
    assert copy["project_id"] == target_id
    assert copy["status"] == "queued"  # copies always start queued
    # Screenshot was cloned: own attachment row + file, same content.
    assert len(copy["attachments"]) == 1
    copy_att = copy["attachments"][0]
    assert copy_att["id"] != aid
    served = client.get(copy_att["url"])
    assert served.status_code == 200 and served.content == _PNG
    # Deleting the original doesn't touch the copy's file.
    assert client.delete(f"/api/prompts/{src['id']}", headers=headers).status_code == 204
    assert client.get(copy_att["url"]).status_code == 200

    # Unknown / foreign project is rejected.
    bad = client.post(
        f"/api/prompts/{copy['id']}/duplicate", json={"project_id": 99999}, headers=headers
    )
    assert bad.status_code == 400


def test_tenant_isolation(client):
    # User A creates a prompt.
    csrf_a = _auth(client, email="a@example.com", sub="sub-a")
    cp = client.post("/api/prompts", json={"body": "secret of A"}, headers={"X-CSRF-Token": csrf_a})
    assert cp.status_code == 201, cp.text
    a_id = cp.json()["id"]
    assert len(client.get("/api/prompts").json()) == 1

    # Switch to user B: must not see A's prompt, and cannot fetch it by id.
    client.cookies.clear()
    _auth(client, email="b@example.com", sub="sub-b")
    assert client.get("/api/prompts").json() == []
    assert client.get(f"/api/prompts/{a_id}").status_code == 404


def test_import_and_export(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    content = "First prompt block\n---\nSecond prompt block"
    files = {"files": ("prompts.txt", io.BytesIO(content.encode()), "text/plain")}
    imp = client.post(
        "/api/import",
        files=files,
        data={"split_delimiter": "rule"},
        headers=headers,
    )
    assert imp.status_code == 200, imp.text
    assert len(imp.json()) == 2

    exp = client.get("/api/export")
    assert exp.status_code == 200
    assert len(exp.json()["prompts"]) == 2

    zexp = client.get("/api/export/txt")
    assert zexp.status_code == 200
    assert zexp.headers["content-type"] == "application/zip"


def _mk_prompt(client, headers, body="do the thing") -> int:
    r = client.post("/api/prompts", json={"body": body}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_run_full_flow(client):
    csrf = _auth(client)  # owner@example.com
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)

    cr = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    )
    assert cr.status_code == 201, cr.text
    run_id = cr.json()["id"]
    assert cr.json()["status"] == "queued"
    assert cr.json()["steps_total"] == 1 and cr.json()["steps_done"] == 0

    # Creating the run mirrors the prompt into the Running column.
    assert client.get(f"/api/prompts/{pid}").json()["status"] == "running"

    listed = client.get("/api/runs").json()
    assert len(listed) == 1
    assert listed[0]["steps_total"] == 1 and listed[0]["steps_done"] == 0

    # Runner claims it (atomic) -> claiming + one step.
    claim = client.post("/api/runs/claim", json={"runner_id": "r1"}, headers=_RUNNER_HDR)
    assert claim.status_code == 200, claim.text
    assert claim.json()["status"] == "claiming"
    assert len(claim.json()["steps"]) == 1
    assert claim.json()["steps"][0]["prompt_text"] == "do the thing"

    # No second run to claim.
    assert client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).status_code == 204

    hb = client.post(f"/api/runs/{run_id}/heartbeat", headers=_RUNNER_HDR)
    assert hb.status_code == 200 and hb.json()["status"] == "running"
    assert hb.json()["cancel_requested"] is False

    client.post(
        f"/api/runs/{run_id}/log",
        json={"step_index": 0, "lines": [{"event_type": "system", "line": "init"}]},
        headers=_RUNNER_HDR,
    )
    client.post(
        f"/api/runs/{run_id}/steps/0/result",
        json={"status": "succeeded", "claude_session_id": "sess-1", "output": "done", "cost_usd": 0.02},
        headers=_RUNNER_HDR,
    )
    client.post(
        f"/api/runs/{run_id}/result",
        json={"status": "succeeded", "total_cost_usd": 0.02},
        headers=_RUNNER_HDR,
    )

    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["status"] == "succeeded"
    assert detail["steps_done"] == 1 and detail["steps_total"] == 1
    assert detail["claude_session_id"] == "sess-1"
    assert detail["steps"][0]["output"] == "done"
    assert any(lg["event_type"] == "system" for lg in detail["logs"])

    # The successful step moved its source prompt to done.
    prompt = client.get(f"/api/prompts/{pid}").json()
    assert prompt["status"] == "done"


def test_failed_step_marks_prompt_failed(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    run_id = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    ).json()["id"]
    client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR)
    client.post(
        f"/api/runs/{run_id}/steps/0/result",
        json={"status": "failed", "exit_code": 1},
        headers=_RUNNER_HDR,
    )
    assert client.get(f"/api/prompts/{pid}").json()["status"] == "failed"


def test_run_prompts_move_to_running_and_release_on_cancel(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk_prompt(client, headers, "step one")
    b = _mk_prompt(client, headers, "step two")
    run_id = client.post(
        "/api/runs",
        json={"kind": "chain", "prompt_ids": [a, b], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    ).json()["id"]
    assert client.get(f"/api/prompts/{a}").json()["status"] == "running"
    assert client.get(f"/api/prompts/{b}").json()["status"] == "running"

    # Canceling the still-queued run releases both prompts back to the queue.
    r = client.post(f"/api/runs/{run_id}/cancel", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "canceled"
    assert client.get(f"/api/prompts/{a}").json()["status"] == "queued"
    assert client.get(f"/api/prompts/{b}").json()["status"] == "queued"


def test_run_result_releases_unexecuted_steps(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk_prompt(client, headers, "step one")
    b = _mk_prompt(client, headers, "step two")
    run_id = client.post(
        "/api/runs",
        json={"kind": "chain", "prompt_ids": [a, b], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    ).json()["id"]
    client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR)
    # Step 0 fails, the runner stops (stop_on_error) and reports the run failed.
    client.post(
        f"/api/runs/{run_id}/steps/0/result",
        json={"status": "failed", "exit_code": 1},
        headers=_RUNNER_HDR,
    )
    client.post(
        f"/api/runs/{run_id}/result",
        json={"status": "failed", "error": "step 1 failed"},
        headers=_RUNNER_HDR,
    )
    # The executed step keeps its outcome, the never-run step returns to queued.
    assert client.get(f"/api/prompts/{a}").json()["status"] == "failed"
    assert client.get(f"/api/prompts/{b}").json()["status"] == "queued"


def test_done_status_goes_to_top(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk_prompt(client, headers, "prompt a")
    b = _mk_prompt(client, headers, "prompt b")

    ra = client.patch(f"/api/prompts/{a}", json={"status": "done"}, headers=headers)
    rb = client.patch(f"/api/prompts/{b}", json={"status": "done"}, headers=headers)
    assert ra.status_code == 200 and rb.status_code == 200
    # b was moved later -> it sits ABOVE a in the done column.
    assert rb.json()["sort_order"] < ra.json()["sort_order"]
    done = [p["id"] for p in client.get("/api/prompts?status=done").json()]
    assert done.index(b) < done.index(a)


def test_blocked_flow(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)

    r = client.patch(f"/api/prompts/{pid}", json={"blocked": True}, headers=headers)
    assert r.status_code == 200 and r.json()["blocked"] is True

    # Blocked prompts refuse running/done ...
    assert (
        client.patch(f"/api/prompts/{pid}", json={"status": "running"}, headers=headers).status_code
        == 400
    )
    assert (
        client.patch(f"/api/prompts/{pid}", json={"status": "done"}, headers=headers).status_code
        == 400
    )
    # ... but may still be archived — leaving queued clears the flag
    # (blocked only exists on queued prompts).
    r = client.patch(f"/api/prompts/{pid}", json={"status": "archived"}, headers=headers)
    assert r.status_code == 200 and r.json()["blocked"] is False
    # Blocking a non-queued prompt is rejected.
    assert (
        client.patch(f"/api/prompts/{pid}", json={"blocked": True}, headers=headers).status_code
        == 400
    )
    # Back to queued, block again — unblock + move works in a single PATCH.
    assert (
        client.patch(f"/api/prompts/{pid}", json={"status": "queued"}, headers=headers).status_code
        == 200
    )
    assert (
        client.patch(f"/api/prompts/{pid}", json={"blocked": True}, headers=headers).status_code
        == 200
    )
    r = client.patch(
        f"/api/prompts/{pid}", json={"blocked": False, "status": "running"}, headers=headers
    )
    assert r.status_code == 200
    assert r.json()["blocked"] is False and r.json()["status"] == "running"


def test_run_path_whitelist(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    for bad in ("/etc", "/Users/martin/claude/../secret", "relative/path"):
        r = client.post(
            "/api/runs",
            json={"kind": "single", "prompt_ids": [pid], "project_path": bad},
            headers=headers,
        )
        assert r.status_code == 400, f"{bad} -> {r.status_code}"


def test_run_chain_requires_two(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    r = client.post(
        "/api/runs",
        json={"kind": "chain", "prompt_ids": [pid], "project_path": "/Users/martin/claude"},
        headers=headers,
    )
    assert r.status_code == 400


def test_run_owner_gate(client):
    csrf = _auth(client, email="intruder@example.com", sub="sub-intruder")
    headers = {"X-CSRF-Token": csrf}
    assert client.get("/api/runs").status_code == 403
    r = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [1], "project_path": "/Users/martin/claude"},
        headers=headers,
    )
    assert r.status_code == 403


def test_runner_auth(client):
    assert client.post("/api/runs/claim", json={}).status_code == 401
    assert client.post(
        "/api/runs/claim", json={}, headers={"Authorization": "Bearer wrong"}
    ).status_code == 401


def test_atomic_claim_distinct(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    p1, p2 = _mk_prompt(client, headers, "one"), _mk_prompt(client, headers, "two")
    for pid in (p1, p2):
        client.post(
            "/api/runs",
            json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude"},
            headers=headers,
        )
    a = client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).json()["id"]
    b = client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).json()["id"]
    assert a != b
    assert client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).status_code == 204


def test_run_cancel_queued(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    run_id = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude"},
        headers=headers,
    ).json()["id"]
    c = client.post(f"/api/runs/{run_id}/cancel", headers=headers)
    assert c.status_code == 200 and c.json()["status"] == "canceled"
    # A canceled (queued) run is not claimable.
    assert client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR).status_code == 204


def test_run_reaper(client):
    from datetime import timedelta

    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Run, RunKind, RunStatus, RunStep, utcnow
    from app.routers import runs as runs_router

    uid = _make_user()
    old = utcnow() - timedelta(seconds=10000)
    with Session(db_module.engine) as s:
        stale = Run(user_id=uid, kind=RunKind.single, project_path="/Users/martin/claude",
                    status=RunStatus.running, last_heartbeat=old)
        fresh = Run(user_id=uid, kind=RunKind.single, project_path="/Users/martin/claude",
                    status=RunStatus.running, last_heartbeat=utcnow())
        queued = Run(user_id=uid, kind=RunKind.single, project_path="/Users/martin/claude",
                     status=RunStatus.queued)
        for r in (stale, fresh, queued):
            s.add(r)
        s.commit()
        for r in (stale, fresh, queued):
            s.refresh(r)
        s.add(RunStep(run_id=stale.id, step_index=0, prompt_text="x", status=RunStatus.running))
        s.commit()
        stale_id, fresh_id, queued_id = stale.id, fresh.id, queued.id

    with Session(db_module.engine) as s:
        assert runs_router.reap_stale(s, 300) == 1

    with Session(db_module.engine) as s:
        stale = s.get(Run, stale_id)
        assert stale.status == RunStatus.failed and stale.error == "runner timeout"
        assert s.get(Run, fresh_id).status == RunStatus.running  # recent heartbeat -> kept
        assert s.get(Run, queued_id).status == RunStatus.queued  # not in-flight -> untouched
        step = s.exec(select(RunStep).where(RunStep.run_id == stale_id)).first()
        assert step.status == RunStatus.failed


def test_capture_flow(client):
    csrf = _auth(client)  # creates the owner user (owner@example.com) + cookie
    headers = {"X-CSRF-Token": csrf}

    # Ingest (capture token, no cookie needed).
    body = {
        "items": [
            {"session_id": "sess-A", "cwd": "/Users/martin/claude/cue/sub", "prompt": "first", "seq": 1},
            {"session_id": "sess-A", "cwd": "/Users/martin/claude/cue", "prompt": "second", "seq": 2},
            {"session_id": "sess-B", "cwd": "/Users/martin/claude/inspector-rust", "prompt": "other", "seq": 1},
        ]
    }
    r = client.post("/api/capture", json=body, headers=_CAPTURE_HDR)
    assert r.status_code == 200, r.text
    assert r.json() == {"stored": 3, "skipped": 0}

    # Dedup: re-sending seq 1 of sess-A is skipped.
    r2 = client.post(
        "/api/capture",
        json={"items": [{"session_id": "sess-A", "cwd": "/Users/martin/claude/cue", "prompt": "first", "seq": 1}]},
        headers=_CAPTURE_HDR,
    )
    assert r2.json() == {"stored": 0, "skipped": 1}

    # Sessions (owner cookie), newest first; project derived from cwd.
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 2
    by_sid = {s["claude_session_id"]: s for s in sessions}
    assert by_sid["sess-A"]["project_name"] == "cue"
    assert by_sid["sess-A"]["prompt_count"] == 2
    assert by_sid["sess-B"]["project_name"] == "inspector-rust"

    # Detail: prompts newest-first.
    sid = by_sid["sess-A"]["id"]
    detail = client.get(f"/api/sessions/{sid}").json()
    assert [p["text"] for p in detail["prompts"]] == ["second", "first"]

    # Promote a captured prompt into a real queued prompt in the same project.
    cp_id = detail["prompts"][1]["id"]
    pr = client.post(f"/api/sessions/{sid}/prompts/{cp_id}/promote", headers=headers)
    assert pr.status_code == 201, pr.text
    assert pr.json()["body"] == "first"
    assert pr.json()["status"] == "queued"
    assert pr.json()["project_id"] == by_sid["sess-A"]["project_id"]


def test_capture_git_root_project_derivation(client):
    """Hook-reported git roots split grouping folders (`_customers/...`) into
    real projects; items without git_root keep the legacy first-segment name."""
    _auth(client)
    items = [
        # cwd deep inside a repo nested under _customers/<kunde>/<projekt>
        {"session_id": "s-c1", "cwd": "/Users/martin/claude/_customers/celox/website/src",
         "prompt": "a", "seq": 1, "git_root": "/Users/martin/claude/_customers/celox/website"},
        # repo directly under _customers
        {"session_id": "s-c2", "cwd": "/Users/martin/claude/_customers/hus-ic",
         "prompt": "b", "seq": 1, "git_root": "/Users/martin/claude/_customers/hus-ic"},
        # plain top-level repo -> unchanged
        {"session_id": "s-c3", "cwd": "/Users/martin/claude/cue/frontend",
         "prompt": "c", "seq": 1, "git_root": "/Users/martin/claude/cue"},
        # repo itself underscore-named -> keeps its own name
        {"session_id": "s-c4", "cwd": "/Users/martin/claude/_customers/_drafts",
         "prompt": "d", "seq": 1, "git_root": "/Users/martin/claude/_customers/_drafts"},
        # old hook (no git_root) -> fallback skips `_` grouping folders
        {"session_id": "s-c5", "cwd": "/Users/martin/claude/_customers/legacy/x",
         "prompt": "e", "seq": 1},
        # non-repo cwd directly in a customer folder -> customer name
        {"session_id": "s-c7", "cwd": "/Users/martin/claude/_customers/celox",
         "prompt": "g", "seq": 1},
        # git root outside the base -> fallback too
        {"session_id": "s-c6", "cwd": "/Users/martin/claude/cue",
         "prompt": "f", "seq": 1, "git_root": "/Users/martin"},
    ]
    r = client.post("/api/capture", json={"items": items}, headers=_CAPTURE_HDR)
    assert r.status_code == 200, r.text
    assert r.json()["stored"] == 7

    sessions = client.get("/api/sessions").json()
    names = {s["claude_session_id"]: s["project_name"] for s in sessions}
    assert names["s-c1"] == "celox/website"
    assert names["s-c2"] == "hus-ic"
    assert names["s-c3"] == "cue"
    assert names["s-c4"] == "_drafts"
    assert names["s-c5"] == "legacy"
    assert names["s-c6"] == "cue"
    assert names["s-c7"] == "celox"
    # s-c3 and s-c6 landed in the same project (both derive to "cue").
    by_sid = {s["claude_session_id"]: s for s in sessions}
    assert by_sid["s-c3"]["project_id"] == by_sid["s-c6"]["project_id"]


def test_capture_auth(client):
    assert client.post("/api/capture", json={"items": []}).status_code == 401
    assert (
        client.post("/api/capture", json={"items": []}, headers={"Authorization": "Bearer nope"}).status_code
        == 401
    )


def test_capture_outside_base(client):
    _auth(client)
    r = client.post(
        "/api/capture",
        json={"items": [{"session_id": "s", "cwd": "/etc", "prompt": "x", "seq": 1}]},
        headers=_CAPTURE_HDR,
    )
    assert r.json()["stored"] == 1
    sessions = client.get("/api/sessions").json()
    assert sessions[0]["project_id"] is None  # cwd outside base -> no project


def test_capture_per_user_token(client):
    # A non-owner user generates their own capture token + base.
    csrf = _auth(client, email="dev2@example.com", sub="sub-dev2")
    headers = {"X-CSRF-Token": csrf}
    r = client.post(
        "/api/capture/settings",
        json={"regenerate": True, "project_base": "/Users/martin/claude"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    assert tok and r.json()["has_token"] is True

    # Ingest with the per-user token -> attributed to dev2, project derived.
    ing = client.post(
        "/api/capture",
        json={"items": [{"session_id": "u2", "cwd": "/Users/martin/claude/proj2", "prompt": "hi", "seq": 1}]},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert ing.json()["stored"] == 1
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 1 and sessions[0]["project_name"] == "proj2"

    # Settings GET reflects the saved base + token presence (never the token).
    g = client.get("/api/capture/settings").json()
    assert g["project_base"] == "/Users/martin/claude"
    assert g["has_token"] is True and g.get("token") is None


def test_delete_prompt_after_run(client):
    """Deleting a prompt used in a run must not FK-crash on RunStep.prompt_id."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    cr = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=headers,
    )
    assert cr.status_code == 201, cr.text  # run snapshots a RunStep referencing pid
    d = client.delete(f"/api/prompts/{pid}", headers=headers)
    assert d.status_code == 204, d.text
    assert client.get("/api/prompts").json() == []


def test_delete_project_with_capture(client):
    """Deleting a project that has capture sessions must not FK-crash."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    client.post(
        "/api/capture",
        json={"items": [{"session_id": "sX", "cwd": "/Users/martin/claude/cue", "prompt": "hi", "seq": 1}]},
        headers=_CAPTURE_HDR,
    )
    project_id = client.get("/api/sessions").json()[0]["project_id"]
    assert project_id is not None
    d = client.delete(f"/api/projects/{project_id}", headers=headers)
    assert d.status_code == 204, d.text
    assert client.get("/api/sessions").json()[0]["project_id"] is None  # unassigned, not deleted


def _capture_with_terminal(client, session_id="sT", cwd="/Users/martin/claude/cue", iterm="w0t0p0:ABCDEF0123456789"):
    return client.post(
        "/api/capture",
        json={"items": [{
            "session_id": session_id, "cwd": cwd, "prompt": "hi", "seq": 1,
            "term_program": "iTerm.app", "iterm_session_id": iterm,
        }]},
        headers=_CAPTURE_HDR,
    )


def test_send_to_session_flow(client):
    csrf = _auth(client)  # owner
    headers = {"X-CSRF-Token": csrf}
    _capture_with_terminal(client)
    s = client.get("/api/sessions").json()[0]
    assert s["deliverable"] is True

    # Owner queues a delivery.
    r = client.post(f"/api/sessions/{s['id']}/send", json={"text": "run the tests", "submit": True}, headers=headers)
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["status"] == "queued"

    # Runner claims it (atomic) and gets the transport + target.
    claim = client.get("/api/cli/claim", headers=_RUNNER_HDR)
    assert claim.status_code == 200, claim.text
    body = claim.json()
    assert body["transport"] == "iterm"
    assert body["iterm_session_id"] == "w0t0p0:ABCDEF0123456789"
    assert body["text"] == "run the tests" and body["submit"] is True

    # No second delivery to claim.
    assert client.get("/api/cli/claim", headers=_RUNNER_HDR).status_code == 204

    # Runner reports success; owner sees it.
    assert client.post(f"/api/cli/{did}/result", json={"status": "sent"}, headers=_RUNNER_HDR).status_code == 204
    assert client.get(f"/api/cli/{did}", headers=headers).json()["status"] == "sent"


def test_send_requires_reachable_terminal(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    # cwd outside base still creates a session, but with no terminal context.
    client.post("/api/capture", json={"items": [{"session_id": "sNoTerm", "cwd": "/Users/martin/claude/cue", "prompt": "x", "seq": 1}]}, headers=_CAPTURE_HDR)
    s = client.get("/api/sessions").json()[0]
    assert s["deliverable"] is False
    r = client.post(f"/api/sessions/{s['id']}/send", json={"text": "hi"}, headers=headers)
    assert r.status_code == 409


def test_send_owner_only(client):
    # A non-owner allowlisted user must not be able to send (drives owner's terminal).
    csrf = _auth(client, email="other@example.com", sub="other")
    headers = {"X-CSRF-Token": csrf}
    # other user has no sessions; a made-up id must 403 (owner gate) before 404.
    r = client.post("/api/sessions/1/send", json={"text": "hi"}, headers=headers)
    assert r.status_code == 403


def test_cli_claim_requires_runner_token(client):
    assert client.get("/api/cli/claim").status_code == 401
    assert client.get("/api/cli/claim", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_delete_session_with_delivery(client):
    """Deleting a session that has a CliDelivery must not FK-crash."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _capture_with_terminal(client)
    s = client.get("/api/sessions").json()[0]
    r = client.post(f"/api/sessions/{s['id']}/send", json={"text": "hi", "submit": False}, headers=headers)
    assert r.status_code == 201, r.text
    # Session now has a delivery row FK'ing it; delete must still succeed.
    d = client.delete(f"/api/sessions/{s['id']}", headers=headers)
    assert d.status_code == 204, d.text
    assert client.get("/api/sessions").json() == []


def test_delivery_stale_reaper(client):
    """A delivery stuck in 'sending' past the timeout is failed on the next claim."""
    import datetime as _dt

    import app.db as db_module
    from sqlmodel import Session as _S

    from app.models import CaptureSession, CliDelivery, DeliveryStatus

    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _capture_with_terminal(client)
    s = client.get("/api/sessions").json()[0]

    # Create a delivery, then force it into 'sending' backdated past the timeout.
    did = client.post(f"/api/sessions/{s['id']}/send", json={"text": "x"}, headers=headers).json()["id"]
    with _S(db_module.engine) as sess:
        row = sess.get(CliDelivery, did)
        row.status = DeliveryStatus.sending
        row.created_at = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=600)
        sess.add(row)
        sess.commit()

    # Next claim reaps it (no queued rows -> 204), and the row is now 'failed'.
    assert client.get("/api/cli/claim", headers=_RUNNER_HDR).status_code == 204
    assert client.get(f"/api/cli/{did}", headers=headers).json()["status"] == "failed"


# ======================================================================
# Google OAuth (routers/auth.py) — Google's HTTP calls are monkeypatched.
# ======================================================================


def _oauth_callback(client, monkeypatch, profile=None, token_resp=None, state_override=None,
                    post_form=None):
    """Run the full login→callback dance with Google faked. Returns (response, calls)."""
    from urllib.parse import parse_qs, urlparse

    from app.routers import auth as auth_module

    if profile is None:
        profile = {
            "sub": "google-sub-1",
            "email": "owner@example.com",
            "email_verified": True,
            "name": "Owner",
            "picture": "https://pic.example/1.png",
        }
    calls: dict = {}

    def fake_post_form(url, data):
        calls["token_url"] = url
        calls["token_request"] = data
        return {"access_token": "at-123"} if token_resp is None else token_resp

    def fake_get_json(url, bearer):
        calls["userinfo_url"] = url
        calls["bearer"] = bearer
        return profile

    monkeypatch.setattr(auth_module, "_post_form", post_form or fake_post_form)
    monkeypatch.setattr(auth_module, "_get_json", fake_get_json)

    login = client.get("/api/auth/google/login", follow_redirects=False)
    assert login.status_code == 302
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    cb = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state if state_override is None else state_override},
        follow_redirects=False,
    )
    return cb, calls


def test_google_login_redirects_to_consent_screen(client):
    r = client.get("/api/auth/google/login", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "redirect_uri=" in loc and "state=" in loc and "response_type=code" in loc
    # The signed state is mirrored into a cookie that survives the redirect.
    assert client.cookies.get("cue_oauth_state")


def test_oauth_callback_success_signs_user_in(client, monkeypatch):
    cb, calls = _oauth_callback(client, monkeypatch)
    assert cb.status_code == 302 and cb.headers["location"] == "/"
    assert client.cookies.get("cue_session")
    assert client.cookies.get("cue_csrf")
    # The code was exchanged and the profile fetched with the access token.
    assert calls["token_request"]["code"] == "code-1"
    assert calls["token_request"]["grant_type"] == "authorization_code"
    assert calls["bearer"] == "at-123"
    # The session actually authenticates API calls.
    me = client.get("/api/auth/me").json()
    assert me["authenticated"] is True
    assert me["user"]["email"] == "owner@example.com"
    assert me["csrf_token"]
    assert client.get("/api/prompts").status_code == 200


def test_oauth_callback_owner_claims_orphan_rows(client, monkeypatch):
    """OWNER_EMAIL's first login adopts pre-multi-tenant rows (user_id IS NULL)."""
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Project, Prompt

    with Session(db_module.engine) as s:
        s.add(Project(name="legacy-project", color="#123456", user_id=None))
        s.add(Prompt(title="legacy", body="old prompt", user_id=None))
        s.commit()

    cb, _ = _oauth_callback(client, monkeypatch)  # owner@example.com == OWNER_EMAIL
    assert cb.status_code == 302

    with Session(db_module.engine) as s:
        project = s.exec(select(Project).where(Project.name == "legacy-project")).one()
        prompt = s.exec(select(Prompt).where(Prompt.title == "legacy")).one()
        assert project.user_id is not None
        assert prompt.user_id == project.user_id
    # The adopted prompt is visible through the API now.
    assert len(client.get("/api/prompts").json()) == 1


def test_oauth_callback_rejects_state_mismatch(client, monkeypatch):
    cb, _ = _oauth_callback(client, monkeypatch, state_override="tampered-state")
    assert cb.status_code == 302
    assert cb.headers["location"] == "/?auth_error=state"
    assert not client.cookies.get("cue_session")


def test_oauth_callback_requires_code(client):
    r = client.get("/api/auth/google/callback", follow_redirects=False)
    assert r.headers["location"] == "/?auth_error=denied"
    r2 = client.get(
        "/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert r2.headers["location"] == "/?auth_error=denied"


def test_oauth_callback_rejects_unverified_email(client, monkeypatch):
    cb, _ = _oauth_callback(
        client,
        monkeypatch,
        profile={"sub": "s", "email": "x@example.com", "email_verified": False},
    )
    assert cb.headers["location"] == "/?auth_error=profile"
    assert not client.cookies.get("cue_session")


def test_oauth_callback_rejects_missing_access_token(client, monkeypatch):
    cb, _ = _oauth_callback(client, monkeypatch, token_resp={"error": "invalid_grant"})
    assert cb.headers["location"] == "/?auth_error=token"


def test_oauth_callback_handles_google_outage(client, monkeypatch):
    def broken_post_form(url, data):
        raise OSError("google is down")

    cb, _ = _oauth_callback(client, monkeypatch, post_form=broken_post_form)
    assert cb.headers["location"] == "/?auth_error=google"


def test_oauth_callback_enforces_allowlist(client, monkeypatch):
    from app.routers import auth as auth_module

    monkeypatch.setattr(auth_module._settings, "allowed_emails", {"someone@else.com"})
    cb, _ = _oauth_callback(client, monkeypatch)
    assert cb.headers["location"] == "/?auth_error=forbidden"
    assert not client.cookies.get("cue_session")


def test_oauth_callback_updates_existing_user(client, monkeypatch):
    """A returning google_sub is updated in place, never duplicated."""
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import User

    with Session(db_module.engine) as s:
        s.add(User(google_sub="google-sub-1", email="old@example.com", name="Old Name"))
        s.commit()

    cb, _ = _oauth_callback(client, monkeypatch)
    assert cb.status_code == 302 and cb.headers["location"] == "/"

    with Session(db_module.engine) as s:
        users = s.exec(select(User).where(User.google_sub == "google-sub-1")).all()
        assert len(users) == 1
        assert users[0].email == "owner@example.com"
        assert users[0].name == "Owner"
        assert users[0].last_login_at is not None


def test_me_unauthenticated(client):
    me = client.get("/api/auth/me").json()
    assert me == {"authenticated": False, "csrf_token": None, "user": None}
    client.cookies.set("cue_session", "garbage-token")
    assert client.get("/api/auth/me").json()["authenticated"] is False


def test_me_for_deleted_user(client):
    """A valid session whose user row is gone must not authenticate."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import User

    _auth(client)
    with Session(db_module.engine) as s:
        user = s.exec(__import__("sqlmodel").select(User)).first()
        s.delete(user)
        s.commit()
    assert client.get("/api/auth/me").json()["authenticated"] is False


def test_logout_clears_session(client):
    csrf = _login(client)
    r = client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200 and r.json() == {"ok": True}
    # Both cookies are expired in the response (the browser drops them).
    cleared = ",".join(r.headers.get_list("set-cookie"))
    assert 'cue_session="";' in cleared and 'cue_csrf="";' in cleared
    # Without the cookie the API is unauthenticated again.
    client.cookies.clear()
    assert client.get("/api/prompts").status_code == 401


def test_logout_requires_csrf(client):
    _login(client)
    assert client.post("/api/auth/logout").status_code == 403


# ======================================================================
# Security primitives (security.py)
# ======================================================================


def test_session_token_tamper_and_expiry():
    from app import security

    token = security.issue_session(42)
    assert security.read_session(token)["uid"] == 42
    assert security.read_session(None) is None
    assert security.read_session("") is None
    assert security.read_session(token[:-4] + "XXXX") is None  # tampered signature
    assert security.read_session(token, max_age=-1) is None  # expired
    assert security.csrf_from_session("garbage") is None


def test_csrf_double_submit_matching():
    from app import security

    token = security.issue_session(1)
    csrf = security.csrf_from_session(token)
    assert security.csrf_matches(token, csrf) is True
    assert security.csrf_matches(token, "wrong") is False
    assert security.csrf_matches(token, None) is False
    assert security.csrf_matches(None, csrf) is False
    assert security.csrf_matches("garbage", csrf) is False


def test_oauth_state_tokens():
    from app import security

    state = security.issue_oauth_state()
    assert security.oauth_state_valid(state, state) is True
    other = security.issue_oauth_state()
    assert security.oauth_state_valid(state, other) is False  # echoed != cookie
    assert security.oauth_state_valid(None, state) is False
    assert security.oauth_state_valid(state, None) is False
    assert security.oauth_state_valid("unsigned", "unsigned") is False


# ======================================================================
# Projects (routers/projects.py)
# ======================================================================


def test_project_crud_flow(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    r = client.post("/api/projects", json={"name": "alpha", "color": "#112233"}, headers=headers)
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["prompt_count"] == 0

    # Names are trimmed; empty and duplicate names are rejected.
    assert client.post("/api/projects", json={"name": "   ", "color": "#000000"},
                       headers=headers).status_code == 400
    assert client.post("/api/projects", json={"name": " alpha ", "color": "#000000"},
                       headers=headers).status_code == 409

    # prompt_count reflects the project's prompts.
    client.post("/api/prompts", json={"body": "x", "project_id": pid}, headers=headers)
    listed = client.get("/api/projects").json()
    assert listed[0]["prompt_count"] == 1

    # Rename + recolor.
    r2 = client.post("/api/projects", json={"name": "beta", "color": "#445566"}, headers=headers)
    upd = client.patch(f"/api/projects/{pid}", json={"name": "renamed", "color": "#654321"},
                       headers=headers)
    assert upd.status_code == 200
    assert upd.json()["name"] == "renamed" and upd.json()["color"] == "#654321"
    # Rename clashes and empty rename are rejected.
    assert client.patch(f"/api/projects/{pid}", json={"name": "beta"},
                        headers=headers).status_code == 409
    assert client.patch(f"/api/projects/{pid}", json={"name": "  "},
                        headers=headers).status_code == 400
    # Renaming to its own name is fine (no self-clash).
    assert client.patch(f"/api/projects/{r2.json()['id']}", json={"name": "beta"},
                        headers=headers).status_code == 200

    # Unknown project id -> 404.
    assert client.patch("/api/projects/99999", json={"name": "x"}, headers=headers).status_code == 404
    assert client.delete("/api/projects/99999", headers=headers).status_code == 404


def test_project_reorder(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    ids = [
        client.post("/api/projects", json={"name": f"p{i}", "color": "#111111"},
                    headers=headers).json()["id"]
        for i in range(3)
    ]
    r = client.post(
        "/api/projects/reorder",
        json={"items": [{"id": ids[2], "sort_order": 1}, {"id": ids[1], "sort_order": 2},
                        {"id": ids[0], "sort_order": 3},
                        {"id": 99999, "sort_order": 4}]},  # unknown ids are ignored
        headers=headers,
    )
    assert r.status_code == 200
    assert [p["id"] for p in r.json()] == [ids[2], ids[1], ids[0]]
    # list_projects follows the same order (drives the filter chips).
    assert [p["id"] for p in client.get("/api/projects").json()] == [ids[2], ids[1], ids[0]]


def test_project_name_unique_per_user_not_global(client):
    csrf_a = _auth(client, email="a@example.com", sub="proj-a")
    assert client.post("/api/projects", json={"name": "shared", "color": "#111111"},
                       headers={"X-CSRF-Token": csrf_a}).status_code == 201
    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="proj-b")
    # Same name for another tenant is fine.
    assert client.post("/api/projects", json={"name": "shared", "color": "#222222"},
                       headers={"X-CSRF-Token": csrf_b}).status_code == 201


def test_project_tenant_isolation(client):
    csrf_a = _auth(client, email="a@example.com", sub="pt-a")
    pid = client.post("/api/projects", json={"name": "mine", "color": "#111111"},
                      headers={"X-CSRF-Token": csrf_a}).json()["id"]
    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="pt-b")
    headers_b = {"X-CSRF-Token": csrf_b}
    assert client.get("/api/projects").json() == []
    assert client.patch(f"/api/projects/{pid}", json={"name": "stolen"},
                        headers=headers_b).status_code == 404
    assert client.delete(f"/api/projects/{pid}", headers=headers_b).status_code == 404


def test_delete_project_unassigns_prompts(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    pid = client.post("/api/projects", json={"name": "doomed", "color": "#111111"},
                      headers=headers).json()["id"]
    prompt_id = client.post("/api/prompts", json={"body": "keep me", "project_id": pid},
                            headers=headers).json()["id"]
    assert client.delete(f"/api/projects/{pid}", headers=headers).status_code == 204
    survivor = client.get(f"/api/prompts/{prompt_id}").json()
    assert survivor["project_id"] is None  # prompt survives, unassigned


# ======================================================================
# SPA serving + security headers (main.py)
# ======================================================================


@pytest.fixture()
def spa_client(tmp_path):
    """Client with a built frontend in STATIC_DIR (exercises the SPA branch)."""
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html><body>cue-spa-shell</body></html>")
    (static / "assets" / "app.js").write_text("console.log('cue')")
    (static / "logo.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("TOP-SECRET-OUTSIDE-STATIC")

    os.environ["STATIC_DIR"] = str(static)
    os.environ["DB_PATH"] = str(tmp_path / "cue.db")
    os.environ["UPLOAD_DIR"] = str(tmp_path / "uploads")
    os.environ["ATTACHMENTS_DIR"] = str(tmp_path / "attachments")
    try:
        import importlib

        from app import config

        config.get_settings.cache_clear()
        import app.db as db_module

        importlib.reload(db_module)
        import app.main as main_module

        importlib.reload(main_module)
        with TestClient(main_module.app) as c:
            yield c
    finally:
        del os.environ["STATIC_DIR"]


def test_spa_index_fallback_for_client_routes(spa_client):
    """Unknown paths serve index.html so client-side routing survives reloads."""
    for path in ("/", "/board", "/settings/deep/link"):
        r = spa_client.get(path)
        assert r.status_code == 200, path
        assert "cue-spa-shell" in r.text, path


def test_spa_serves_real_static_files(spa_client):
    r = spa_client.get("/assets/app.js")
    assert r.status_code == 200 and "console.log" in r.text
    r2 = spa_client.get("/logo.svg")
    assert r2.status_code == 200 and r2.text == "<svg/>"


def test_spa_path_traversal_guard(spa_client):
    """Escaping the static dir must never serve files from outside it."""
    for path in ("/%2e%2e/secret.txt", "/..%2Fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"):
        r = spa_client.get(path)
        assert "TOP-SECRET-OUTSIDE-STATIC" not in r.text, path


def test_security_headers_and_csp(client):
    r = client.get("/api/health")
    assert r.json() == {"status": "ok"}
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "same-origin"
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    # Voice dictation needs the mic for same-origin (see CLAUDE.md gotcha).
    assert "microphone=(self)" in r.headers["Permissions-Policy"]


# ======================================================================
# Dependencies (deps.py): Origin check + client IP
# ======================================================================


def test_csrf_origin_check_blocks_foreign_origin(client, monkeypatch):
    from app import deps as deps_module

    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    monkeypatch.setattr(deps_module._settings, "dev_mode", False)
    allowed = deps_module._settings.allowed_origin

    bad = client.post("/api/prompts", json={"body": "x"},
                      headers={**headers, "Origin": "https://evil.example"})
    assert bad.status_code == 403

    good = client.post("/api/prompts", json={"body": "x"},
                       headers={**headers, "Origin": allowed})
    assert good.status_code == 201


def test_get_client_ip_proxy_trust():
    from types import SimpleNamespace

    from app import deps as deps_module

    request = SimpleNamespace(
        headers={"x-forwarded-for": "6.6.6.6, 10.0.0.1"},
        client=SimpleNamespace(host="127.0.0.9"),
    )
    original = deps_module._settings.trust_proxy
    try:
        # Trusted proxy: use the RIGHTMOST hop (appended by our own proxy) —
        # the leftmost is client-controllable and could rotate rate-limit buckets.
        deps_module._settings.trust_proxy = True
        assert deps_module.get_client_ip(request) == "10.0.0.1"
        # Untrusted: XFF is ignored entirely, the socket peer wins.
        deps_module._settings.trust_proxy = False
        assert deps_module.get_client_ip(request) == "127.0.0.9"
        deps_module._settings.trust_proxy = True
        no_client = SimpleNamespace(headers={}, client=None)
        assert deps_module.get_client_ip(no_client) == "unknown"
    finally:
        deps_module._settings.trust_proxy = original


# ======================================================================
# Settings (config.py)
# ======================================================================


def test_settings_validate_fails_fast(monkeypatch):
    from app.config import Settings

    for var in ("SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("CUE_DEV", "0")
    with pytest.raises(RuntimeError) as exc:
        Settings().validate()
    msg = str(exc.value)
    assert "SECRET_KEY" in msg and "GOOGLE_CLIENT_ID" in msg and "GOOGLE_CLIENT_SECRET" in msg

    # Dev mode tolerates the missing secrets (local dev without OAuth).
    monkeypatch.setenv("CUE_DEV", "1")
    Settings().validate()


def test_is_email_allowed_matrix(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("GOOGLE_ALLOWED_EMAILS", " Alice@Example.com , bob@corp.io ")
    monkeypatch.setenv("GOOGLE_ALLOWED_DOMAINS", "Widgets.dev")
    monkeypatch.setenv("CUE_DEV", "0")
    s = Settings()
    assert s.is_email_allowed("alice@example.com") is True  # listed, case-insensitive
    assert s.is_email_allowed("ALICE@EXAMPLE.COM") is True
    assert s.is_email_allowed("carol@widgets.dev") is True  # domain allowlist
    assert s.is_email_allowed("carol@other.dev") is False
    assert s.is_email_allowed("") is False
    assert s.is_email_allowed("no-at-sign") is False

    # No lists at all: closed in prod, open in dev.
    monkeypatch.delenv("GOOGLE_ALLOWED_EMAILS")
    monkeypatch.delenv("GOOGLE_ALLOWED_DOMAINS")
    assert Settings().is_email_allowed("anyone@x.com") is False
    monkeypatch.setenv("CUE_DEV", "1")
    assert Settings().is_email_allowed("anyone@x.com") is True


def test_is_path_allowed_unit(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ALLOWED_PROJECT_BASES", "/base/one,/base/two/")
    s = Settings()
    assert s.is_path_allowed("/base/one") is True
    assert s.is_path_allowed("/base/one/sub/dir") is True
    assert s.is_path_allowed("/base/two/x") is True  # trailing slash normalized
    assert s.is_path_allowed("/base/onemore") is False  # prefix, not a subdir
    assert s.is_path_allowed("/base/one/../../etc") is False
    assert s.is_path_allowed("relative/path") is False
    assert s.is_path_allowed("/base/one\x00") is False
    assert s.is_path_allowed("") is False
    monkeypatch.setenv("ALLOWED_PROJECT_BASES", "")
    assert Settings().is_path_allowed("/base/one") is False  # no whitelist -> closed


def test_capture_project_name_unit(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("CAPTURE_BASE", "/work")
    s = Settings()
    assert s.capture_project_name("/elsewhere/x") is None  # outside base
    assert s.capture_project_name("/work") is None  # base itself -> no project
    assert s.capture_project_name("/work/app/sub") == "app"
    assert s.capture_project_name("/work/_group/client") == "client"  # `_` folder skipped
    assert s.capture_project_name("/work/_only") == "_only"  # all-underscore keeps name
    # Per-user base override wins over the configured base.
    assert s.capture_project_name("/other/app", base="/other") == "app"
    monkeypatch.setenv("CAPTURE_BASE", "")
    monkeypatch.setenv("ALLOWED_PROJECT_BASES", "")
    assert Settings().capture_project_name("/work/app") is None  # no base configured


# ======================================================================
# Attachments (routers/attachments.py)
# ======================================================================


def test_attachment_upload_guards(client, monkeypatch):
    from app.routers import attachments as att_module

    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    empty = client.post("/api/attachments",
                        files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
                        headers=headers)
    assert empty.status_code == 400

    monkeypatch.setattr(att_module._settings, "max_attachment_bytes", 10)
    too_big = client.post("/api/attachments",
                          files={"file": ("big.png", io.BytesIO(b"x" * 11), "image/png")},
                          headers=headers)
    assert too_big.status_code == 413


def test_attachment_tenant_isolation(client):
    csrf_a = _auth(client, email="a@example.com", sub="att-a")
    up = client.post("/api/attachments",
                     files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
                     headers={"X-CSRF-Token": csrf_a})
    aid = up.json()["id"]

    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="att-b")
    assert client.get(f"/api/attachments/{aid}").status_code == 404
    assert client.delete(f"/api/attachments/{aid}",
                         headers={"X-CSRF-Token": csrf_b}).status_code == 404


def test_attachment_direct_delete(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    aid = client.post("/api/attachments",
                      files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
                      headers=headers).json()["id"]
    assert client.get(f"/api/attachments/{aid}").status_code == 200
    assert client.delete(f"/api/attachments/{aid}", headers=headers).status_code == 204
    assert client.get(f"/api/attachments/{aid}").status_code == 404
    assert client.delete(f"/api/attachments/{aid}", headers=headers).status_code == 404


def test_attachment_purge_expired(client):
    import datetime as _dt

    import app.db as db_module
    from sqlmodel import Session

    from app.models import Attachment
    from app.routers import attachments as att_module

    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    old_id = client.post("/api/attachments",
                         files={"file": ("old.png", io.BytesIO(_PNG), "image/png")},
                         headers=headers).json()["id"]
    fresh_id = client.post("/api/attachments",
                           files={"file": ("new.png", io.BytesIO(_PNG), "image/png")},
                           headers=headers).json()["id"]

    with Session(db_module.engine) as s:
        row = s.get(Attachment, old_id)
        row.created_at = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(
            days=att_module.ATTACHMENT_TTL_DAYS + 1
        )
        s.add(row)
        s.commit()

    with Session(db_module.engine) as s:
        assert att_module.purge_expired(s) == 1
        assert att_module.purge_expired(s) == 0  # idempotent

    assert client.get(f"/api/attachments/{old_id}").status_code == 404
    assert client.get(f"/api/attachments/{fresh_id}").status_code == 200


def test_list_attachments_by_prompt(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    aid = client.post("/api/attachments",
                      files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
                      headers=headers).json()["id"]
    pid = client.post("/api/prompts", json={"body": "x", "attachment_ids": [aid]},
                      headers=headers).json()["id"]
    rows = client.get("/api/attachments", params={"prompt_id": pid}).json()
    assert [a["id"] for a in rows] == [aid]
    assert client.get("/api/attachments", params={"prompt_id": 99999}).json() == []


# ======================================================================
# Prompt edge cases (routers/prompts.py)
# ======================================================================


def test_prompt_unknown_ids_404(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    assert client.get("/api/prompts/99999").status_code == 404
    assert client.patch("/api/prompts/99999", json={"title": "x"}, headers=headers).status_code == 404
    assert client.delete("/api/prompts/99999", headers=headers).status_code == 404
    assert client.post("/api/prompts/99999/duplicate", json={"project_id": None},
                       headers=headers).status_code == 404


def test_create_prompt_validation(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    assert client.post("/api/prompts", json={"body": "   "}, headers=headers).status_code == 400
    assert client.post("/api/prompts", json={"body": "x", "project_id": 99999},
                       headers=headers).status_code == 400


def test_title_derivation_edge_cases(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    # A bare heading marker yields no usable title -> fallback.
    r = client.post("/api/prompts", json={"body": "#\nreal text"}, headers=headers)
    assert r.json()["title"] == "Untitled prompt"
    # Long first lines are truncated to 120 chars.
    long_line = "y" * 300
    r2 = client.post("/api/prompts", json={"body": long_line}, headers=headers)
    assert r2.json()["title"] == "y" * 120
    # Blanking the title on PATCH re-derives it from the body.
    r3 = client.patch(f"/api/prompts/{r2.json()['id']}",
                      json={"title": "  ", "body": "# New heading\nbody"}, headers=headers)
    assert r3.json()["title"] == "New heading"


def test_merge_archive_and_keep_variants(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    a, b = _mk_prompt(client, headers, "src a"), _mk_prompt(client, headers, "src b")
    r = client.post("/api/prompts/merge",
                    json={"source_ids": [a, b], "body": "merged", "originals": "archive"},
                    headers=headers)
    assert r.status_code == 201
    assert client.get(f"/api/prompts/{a}").json()["status"] == "archived"
    assert client.get(f"/api/prompts/{b}").json()["status"] == "archived"

    c, d = _mk_prompt(client, headers, "src c"), _mk_prompt(client, headers, "src d")
    r2 = client.post("/api/prompts/merge",
                     json={"source_ids": [c, d], "body": "merged 2", "originals": "keep"},
                     headers=headers)
    assert r2.status_code == 201
    assert client.get(f"/api/prompts/{c}").json()["status"] == "queued"  # untouched

    # Empty body is rejected.
    assert client.post("/api/prompts/merge",
                       json={"source_ids": [c, d], "body": "  ", "originals": "keep"},
                       headers=headers).status_code == 400


def test_merge_delete_carries_attachments_over(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    aid = client.post("/api/attachments",
                      files={"file": ("shot.png", io.BytesIO(_PNG), "image/png")},
                      headers=headers).json()["id"]
    src = client.post("/api/prompts", json={"body": "with pic", "attachment_ids": [aid]},
                      headers=headers).json()["id"]
    other = _mk_prompt(client, headers, "plain")
    merged = client.post("/api/prompts/merge",
                         json={"source_ids": [src, other], "body": "combined",
                               "originals": "delete"},
                         headers=headers).json()
    # The deleted source's screenshot now belongs to the merged prompt.
    assert [a["id"] for a in merged["attachments"]] == [aid]
    assert client.get(f"/api/attachments/{aid}").status_code == 200


def test_merge_rejects_foreign_sources(client):
    csrf_a = _auth(client, email="a@example.com", sub="mrg-a")
    foreign = _mk_prompt(client, {"X-CSRF-Token": csrf_a}, "not yours")
    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="mrg-b")
    headers_b = {"X-CSRF-Token": csrf_b}
    own = _mk_prompt(client, headers_b, "mine")
    r = client.post("/api/prompts/merge",
                    json={"source_ids": [own, foreign], "body": "x", "originals": "keep"},
                    headers=headers_b)
    assert r.status_code == 404
    # Nothing was created or deleted.
    assert client.get(f"/api/prompts/{own}").status_code == 200
    assert len(client.get("/api/prompts").json()) == 1


def test_reorder_ignores_foreign_prompts(client):
    csrf_a = _auth(client, email="a@example.com", sub="ro-a")
    foreign = _mk_prompt(client, {"X-CSRF-Token": csrf_a}, "not yours")
    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="ro-b")
    r = client.post("/api/prompts/reorder",
                    json={"items": [{"id": foreign, "status": "done", "sort_order": 1}]},
                    headers={"X-CSRF-Token": csrf_b})
    assert r.status_code == 200 and r.json() == []  # foreign row silently skipped

    # A's prompt is untouched (still queued).
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt, PromptStatus

    with Session(db_module.engine) as s:
        assert s.get(Prompt, foreign).status == PromptStatus.queued


def test_unassign_project_via_patch(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    pid = client.post("/api/projects", json={"name": "temp", "color": "#111111"},
                      headers=headers).json()["id"]
    prompt = client.post("/api/prompts", json={"body": "x", "project_id": pid},
                         headers=headers).json()
    assert prompt["project_id"] == pid
    r = client.patch(f"/api/prompts/{prompt['id']}", json={"unassign_project": True},
                     headers=headers)
    assert r.status_code == 200 and r.json()["project_id"] is None


# ======================================================================
# Import / export details (routers/importexport.py)
# ======================================================================


def test_import_delimiter_variants(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}

    # "none": one prompt per file, whole content preserved.
    r = client.post("/api/import",
                    files={"files": ("a.txt", io.BytesIO(b"line1\n---\nline2"), "text/plain")},
                    data={"split_delimiter": "none"}, headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1
    assert r.json()[0]["body"] == "line1\n---\nline2"
    assert r.json()[0]["title"] == "line1"

    # "blank": split on blank-line-separated paragraph groups.
    content = b"first block\nstill first\n\nsecond block\n\n\nthird block"
    r2 = client.post("/api/import",
                     files={"files": ("b.txt", io.BytesIO(content), "text/plain")},
                     data={"split_delimiter": "blank"}, headers=headers)
    assert [p["title"] for p in r2.json()] == ["first block", "second block", "third block"]

    # Custom literal delimiter.
    r3 = client.post("/api/import",
                     files={"files": ("c.txt", io.BytesIO(b"one@@@two"), "text/plain")},
                     data={"split_delimiter": "@@@"}, headers=headers)
    assert [p["body"] for p in r3.json()] == ["one", "two"]

    # Empty file imports nothing.
    r4 = client.post("/api/import",
                     files={"files": ("d.txt", io.BytesIO(b"   \n  "), "text/plain")},
                     data={"split_delimiter": "none"}, headers=headers)
    assert r4.json() == []


def test_import_into_project(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    pid = client.post("/api/projects", json={"name": "imp", "color": "#111111"},
                      headers=headers).json()["id"]
    r = client.post("/api/import",
                    files={"files": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
                    data={"split_delimiter": "none", "project_id": str(pid)}, headers=headers)
    assert r.status_code == 200 and r.json()[0]["project_id"] == pid
    # Unknown / foreign project -> 400.
    bad = client.post("/api/import",
                      files={"files": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
                      data={"split_delimiter": "none", "project_id": "99999"}, headers=headers)
    assert bad.status_code == 400


def test_import_multiple_files_keep_queue_order(client):
    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    r = client.post("/api/import",
                    files=[("files", ("a.txt", io.BytesIO(b"A"), "text/plain")),
                           ("files", ("b.txt", io.BytesIO(b"B"), "text/plain"))],
                    data={"split_delimiter": "none"}, headers=headers)
    created = r.json()
    assert [p["body"] for p in created] == ["A", "B"]
    assert created[0]["sort_order"] < created[1]["sort_order"]  # appended in order


def test_export_txt_zip_structure(client):
    import zipfile as _zip

    csrf = _login(client)
    headers = {"X-CSRF-Token": csrf}
    pid = client.post("/api/projects", json={"name": "My Proj!", "color": "#111111"},
                      headers=headers).json()["id"]
    client.post("/api/prompts", json={"title": "Fix Bug", "body": "the body",
                                      "project_id": pid}, headers=headers)
    client.post("/api/prompts", json={"title": "Loose", "body": "unassigned body"},
                headers=headers)

    r = client.get("/api/export/txt")
    assert r.status_code == 200
    zf = _zip.ZipFile(io.BytesIO(r.content))
    names = sorted(zf.namelist())
    assert len(names) == 2
    proj_file = next(n for n in names if "fix-bug" in n)
    loose_file = next(n for n in names if "loose" in n)
    assert proj_file.startswith("my-proj/")  # project name slugified into a folder
    assert loose_file.startswith("unassigned/")
    assert zf.read(proj_file).decode() == "the body"
    assert zf.read(loose_file).decode() == "unassigned body"


def test_export_json_is_tenant_scoped(client):
    csrf_a = _auth(client, email="a@example.com", sub="exp-a")
    client.post("/api/prompts", json={"body": "A's secret"},
                headers={"X-CSRF-Token": csrf_a})
    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="exp-b")
    client.post("/api/projects", json={"name": "b-proj", "color": "#222222"},
                headers={"X-CSRF-Token": csrf_b})
    exp = client.get("/api/export").json()
    assert exp["version"] == 1
    assert exp["prompts"] == []  # none of A's rows leak into B's export
    assert [p["name"] for p in exp["projects"]] == ["b-proj"]
    assert "attachment" in client.get("/api/export").headers["content-disposition"]


# ======================================================================
# Run engine edge cases (routers/runs.py)
# ======================================================================


def test_run_log_after_seq_pagination(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    run_id = client.post("/api/runs",
                         json={"kind": "single", "prompt_ids": [pid],
                               "project_path": "/Users/martin/claude/cue"},
                         headers=headers).json()["id"]
    client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR)
    client.post(f"/api/runs/{run_id}/log",
                json={"step_index": 0, "lines": [{"event_type": "system", "line": "one"},
                                                 {"event_type": "assistant", "line": "two"}]},
                headers=_RUNNER_HDR)
    client.post(f"/api/runs/{run_id}/log",
                json={"step_index": 0, "lines": [{"event_type": "result", "line": "three"}]},
                headers=_RUNNER_HDR)

    all_logs = client.get(f"/api/runs/{run_id}").json()["logs"]
    assert [lg["line"] for lg in all_logs] == ["one", "two", "three"]
    assert [lg["seq"] for lg in all_logs] == [1, 2, 3]  # seq continues across batches

    # after_seq returns only newer lines (the frontend's incremental poll).
    tail = client.get(f"/api/runs/{run_id}", params={"after_seq": 2}).json()["logs"]
    assert [lg["line"] for lg in tail] == ["three"]


def test_cancel_running_run_flags_cancel_requested(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    pid = _mk_prompt(client, headers)
    run_id = client.post("/api/runs",
                         json={"kind": "single", "prompt_ids": [pid],
                               "project_path": "/Users/martin/claude/cue"},
                         headers=headers).json()["id"]
    client.post("/api/runs/claim", json={}, headers=_RUNNER_HDR)
    client.post(f"/api/runs/{run_id}/heartbeat", headers=_RUNNER_HDR)  # claiming -> running

    r = client.post(f"/api/runs/{run_id}/cancel", headers=headers)
    # A running run is NOT hard-canceled — the runner learns via the heartbeat.
    assert r.json()["status"] == "running" and r.json()["cancel_requested"] is True
    hb = client.post(f"/api/runs/{run_id}/heartbeat", headers=_RUNNER_HDR)
    assert hb.json()["cancel_requested"] is True

    # Cancel on a terminal run is a no-op.
    client.post(f"/api/runs/{run_id}/result", json={"status": "canceled"}, headers=_RUNNER_HDR)
    again = client.post(f"/api/runs/{run_id}/cancel", headers=headers)
    assert again.json()["status"] == "canceled"


def test_runs_config_and_status_filter(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    cfg = client.get("/api/runs/config")
    assert cfg.status_code == 200
    assert "/Users/martin/claude" in cfg.json()["allowed_bases"]
    assert cfg.json()["permission_modes"] and cfg.json()["models"]

    p1, p2 = _mk_prompt(client, headers, "one"), _mk_prompt(client, headers, "two")
    r1 = client.post("/api/runs", json={"kind": "single", "prompt_ids": [p1],
                                        "project_path": "/Users/martin/claude"},
                     headers=headers).json()["id"]
    client.post("/api/runs", json={"kind": "single", "prompt_ids": [p2],
                                   "project_path": "/Users/martin/claude"}, headers=headers)
    client.post(f"/api/runs/{r1}/cancel", headers=headers)

    queued = client.get("/api/runs", params={"status": "queued"}).json()
    canceled = client.get("/api/runs", params={"status": "canceled"}).json()
    assert len(queued) == 1 and len(canceled) == 1
    assert canceled[0]["id"] == r1


def test_runner_endpoints_unknown_run_404(client):
    assert client.post("/api/runs/no-such-run/heartbeat", headers=_RUNNER_HDR).status_code == 404
    assert client.post("/api/runs/no-such-run/log",
                       json={"step_index": 0, "lines": []}, headers=_RUNNER_HDR).status_code == 404
    assert client.post("/api/runs/no-such-run/steps/0/result",
                       json={"status": "succeeded"}, headers=_RUNNER_HDR).status_code == 404
    assert client.post("/api/runs/no-such-run/result",
                       json={"status": "succeeded"}, headers=_RUNNER_HDR).status_code == 404


def test_run_create_rejects_unknown_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    r = client.post("/api/runs", json={"kind": "single", "prompt_ids": [99999],
                                       "project_path": "/Users/martin/claude"},
                    headers=headers)
    assert r.status_code == 400
    r2 = client.post("/api/runs", json={"kind": "single", "prompt_ids": [],
                                        "project_path": "/Users/martin/claude"},
                     headers=headers)
    assert r2.status_code == 400


# ======================================================================
# Capture sessions: tenancy (routers/capture.py)
# ======================================================================


def test_capture_session_tenant_isolation(client):
    _auth(client)  # owner receives the captured session
    client.post("/api/capture",
                json={"items": [{"session_id": "iso", "cwd": "/Users/martin/claude/cue",
                                 "prompt": "hi", "seq": 1}]},
                headers=_CAPTURE_HDR)
    sid = client.get("/api/sessions").json()[0]["id"]

    client.cookies.clear()
    csrf_b = _auth(client, email="b@example.com", sub="cap-b")
    assert client.get("/api/sessions").json() == []
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    assert client.delete(f"/api/sessions/{sid}",
                         headers={"X-CSRF-Token": csrf_b}).status_code == 404
