"""Shared fixtures/helpers for the API test suite.

The env must be configured BEFORE any `app.*` import (config caches settings at
import time in several modules), so this conftest sets it at collection time.
"""
from __future__ import annotations

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

RUNNER_HDR = {"Authorization": "Bearer test-runner-token"}
CAPTURE_HDR = {"Authorization": "Bearer test-capture-token"}

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


def make_user(email: str = "owner@example.com", sub: str | None = None) -> int:
    """Create a user directly and return its id (OAuth is mocked out in tests)."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import User

    with Session(db_module.engine) as s:
        user = User(google_sub=sub or f"sub-{email}", email=email, name="Test", approved=True)
        s.add(user)
        s.commit()
        s.refresh(user)
        return user.id


def auth(client, email: str = "owner@example.com", sub: str | None = None) -> str:
    """Mint a session cookie for a user and return the CSRF token."""
    from app import security

    uid = make_user(email, sub)
    token = security.issue_session(uid)
    client.cookies.set("cue_session", token)
    return security.csrf_from_session(token)
