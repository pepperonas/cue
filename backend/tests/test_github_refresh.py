"""Token expiry must not force users back through setup every eight hours."""
from datetime import datetime, timedelta, timezone

import pytest
from conftest import auth
from sqlmodel import Session, select
from test_github import _connect, _stored_user, gh  # noqa: F401 (shared HTTP fixture)
from test_project_context import connect, linked_project, repo  # noqa: F401

from app import secrets_store
from app.models import User
from app.projectcontext import github


def expire_owner():
    import app.db as db_module
    with Session(db_module.engine) as session:
        user = session.exec(select(User).where(User.email == "owner@example.com")).one()
        user.github_token_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.add(user)
        session.commit()


def connect_expiring(client, gh):
    csrf = auth(client)
    gh.expiring = True
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    return csrf


def test_expiring_tokens_store_the_refresh_credential_encrypted(client, gh):
    connect_expiring(client, gh)
    user = _stored_user()
    assert user.github_token_expires_at is not None
    assert secrets_store.decrypt(user.github_refresh_token_enc) == "refresh-attrappe-original"
    assert "refresh-attrappe" not in user.github_refresh_token_enc
    assert "refresh_token" not in client.get("/api/github/status").text


def test_expired_access_is_rotated_once_before_reading_repositories(client, gh):
    connect_expiring(client, gh)
    expire_owner()
    assert client.get("/api/github/repos").status_code == 200
    assert gh.refresh_calls == 1
    assert gh.api_tokens[-1] == "token-attrappe-rotated"
    user = _stored_user()
    assert secrets_store.decrypt(user.github_refresh_token_enc) == "refresh-attrappe-rotated"
    assert secrets_store.decrypt(user.github_token_enc) == "token-attrappe-rotated"
    assert client.get("/api/github/repos").status_code == 200
    assert gh.refresh_calls == 1, "a fresh access token must be reused"


def test_a_revoked_refresh_token_forgets_all_connection_credentials(client, gh):
    connect_expiring(client, gh)
    expire_owner()
    gh.refresh_error = github.GitHubError(401, "GitHub-Zugang ist abgelaufen")
    assert client.get("/api/github/repos").status_code == 400
    user = _stored_user()
    assert user.github_token_enc is None and user.github_refresh_token_enc is None
    assert user.github_token_expires_at is None and user.github_login is None
    assert client.get("/api/github/status").json()["connected"] is False


def test_a_network_failure_during_refresh_preserves_the_connection_for_retry(client, gh):
    connect_expiring(client, gh)
    expire_owner()
    previous = _stored_user()
    gh.refresh_error = github.GitHubError(502, "GitHub ist nicht erreichbar")
    assert client.get("/api/github/repos").status_code == 502
    user = _stored_user()
    assert user.github_refresh_token_enc == previous.github_refresh_token_enc
    assert user.github_token_enc == previous.github_token_enc
    gh.refresh_error = None
    assert client.get("/api/github/repos").status_code == 200


def test_disconnect_removes_the_refresh_token_too(client, gh):
    csrf = connect_expiring(client, gh)
    assert client.delete("/api/github/connection", headers={"X-CSRF-Token": csrf}).status_code == 204
    user = _stored_user()
    assert user.github_refresh_token_enc is None and user.github_token_expires_at is None


def test_refresh_uses_the_rotation_grant_and_rejects_github_error_payloads(client, monkeypatch):
    seen = []
    def request(method, url, **kwargs):
        seen.append(kwargs["form"])
        return {"error": "bad_refresh_token"}
    monkeypatch.setattr(github, "request", request)
    with pytest.raises(github.GitHubError) as exc:
        github.refresh_credentials("refresh-attrappe")
    assert exc.value.status == 401
    assert seen[0]["grant_type"] == "refresh_token" and seen[0]["refresh_token"] == "refresh-attrappe"
    assert "scope" not in seen[0], "refresh must never change permissions"


def test_context_refresh_rotates_expired_access_before_fetching(client, repo):
    csrf = auth(client)
    repo.expiring = True
    connect(client)
    expire_owner()
    _pid, project = linked_project(client, csrf)
    assert project["context"]["chars"] > 0
    assert repo.refresh_calls == 1
    assert secrets_store.decrypt(_stored_user().github_token_enc) == "context-rotated-attrappe"


def test_a_second_stale_session_reloads_the_already_rotated_credentials(client, gh):
    import app.db as db_module
    from app.projectcontext import tokens
    connect_expiring(client, gh)
    expire_owner()
    with Session(db_module.engine) as first, Session(db_module.engine) as second:
        a = first.get(User, _stored_user().id)
        b = second.get(User, a.id)
        assert tokens.access_token(first, a) == "token-attrappe-rotated"
        assert tokens.access_token(second, b) == "token-attrappe-rotated"
    assert gh.refresh_calls == 1, "a stale request must not consume the old refresh token again"


def test_expired_access_without_a_readable_refresh_token_needs_reconnection(client, gh):
    import app.db as db_module
    connect_expiring(client, gh)
    expire_owner()
    with Session(db_module.engine) as session:
        user = session.get(User, _stored_user().id)
        user.github_refresh_token_enc = "unreadable-attrappe"
        session.add(user)
        session.commit()
    assert client.get("/api/github/repos").status_code == 400
    assert gh.refresh_calls == 0
    assert _stored_user().github_token_enc is None


def test_another_users_request_never_refreshes_or_uses_the_owners_credentials(client, gh):
    connect_expiring(client, gh)
    expire_owner()
    original = _stored_user()
    auth(client, "other-github@example.com", sub="other-github")
    assert client.get("/api/github/repos").status_code == 400
    assert client.get("/api/github/status").json()["connected"] is False
    assert gh.refresh_calls == 0
    assert _stored_user().github_refresh_token_enc == original.github_refresh_token_enc
