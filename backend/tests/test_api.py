"""Smoke tests for the core flows: login -> CRUD -> reorder -> import -> export."""
from __future__ import annotations

import io
import os

# Configure a known password hash + secret before importing the app.
from argon2 import PasswordHasher

_PW = "test-password-123"
os.environ["SECRET_KEY"] = "test-secret-key-please-change"
os.environ["APP_PASSWORD_HASH"] = PasswordHasher().hash(_PW)
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


def _login(client) -> str:
    resp = client.post("/api/auth/login", json={"password": _PW})
    assert resp.status_code == 200, resp.text
    return resp.json()["csrf_token"]


def test_login_required(client):
    assert client.get("/api/prompts").status_code == 401


def test_wrong_password(client):
    assert client.post("/api/auth/login", json={"password": "nope"}).status_code == 401


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

    # Search filter.
    found = client.get("/api/prompts", params={"q": "parser"})
    assert found.status_code == 200
    assert len(found.json()) == 1

    # CSRF is enforced.
    no_csrf = client.post("/api/prompts", json={"body": "x"})
    assert no_csrf.status_code == 403


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
