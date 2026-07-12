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
