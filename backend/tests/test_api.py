"""Smoke tests for the core flows: auth -> CRUD -> reorder -> import -> export."""
from __future__ import annotations

import io
import os

os.environ["SECRET_KEY"] = "test-secret-key-please-change"
os.environ["COOKIE_SECURE"] = "false"
os.environ["CUE_DEV"] = "1"
os.environ["DB_PATH"] = "data/test-cue.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    os.environ["DB_PATH"] = str(tmp_path / "cue.db")
    os.environ["UPLOAD_DIR"] = str(tmp_path / "uploads")
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
