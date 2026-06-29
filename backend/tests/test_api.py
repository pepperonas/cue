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

_RUNNER_HDR = {"Authorization": "Bearer test-runner-token"}

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

    assert len(client.get("/api/runs").json()) == 1

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
    assert detail["claude_session_id"] == "sess-1"
    assert detail["steps"][0]["output"] == "done"
    assert any(lg["event_type"] == "system" for lg in detail["logs"])


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
