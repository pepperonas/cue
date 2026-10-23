"""Connecting GitHub: the OAuth dance, token storage and disconnect.

GitHub itself is replaced at the one seam everything goes through
(`app.projectcontext.github.request`), so nothing here touches the network.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from conftest import auth

from app.projectcontext import github


class FakeGitHub:
    """Answers the handful of URLs cue calls and records every call."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.expiring = False
        self.refresh_calls = 0
        self.refresh_error = None
        self.api_tokens = []
        self.revoked: dict | None = None
        self.fail: dict[str, github.GitHubError] = {}

    def __call__(self, method, url, *, token=None, accept=github.JSON, form=None, body=None, basic=None):  # noqa: ANN001, ANN003, ANN204
        self.calls.append((method, url))
        for needle, exc in self.fail.items():
            if needle in url:
                raise exc
        if token:
            self.api_tokens.append(token)
        if url == github.TOKEN_URL:
            if form.get("grant_type") == "refresh_token":
                self.refresh_calls += 1
                assert form["refresh_token"] == "refresh-attrappe-original"
                if self.refresh_error:
                    raise self.refresh_error
                return {"access_token": "token-attrappe-rotated", "refresh_token": "refresh-attrappe-rotated", "expires_in": 28800}
            if self.expiring:
                return {"access_token": "token-attrappe-0001", "refresh_token": "refresh-attrappe-original", "expires_in": 28800}
            return {"access_token": "token-attrappe-0001"}  # attrappe: erfunden
        if url.endswith("/user"):
            return {"login": "octo"}
        if "/user/repos" in url:
            return [{"full_name": "octo/app", "default_branch": "main", "private": True}]
        if "/applications/" in url:
            self.revoked = {"body": body, "basic": basic}
            return None
        raise AssertionError(f"unexpected GitHub call {method} {url}")


@pytest.fixture()
def gh(client, monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "github_client_id", "cid-attrappe")
    monkeypatch.setattr(settings, "github_client_secret", "secret-attrappe")
    fake = FakeGitHub()
    monkeypatch.setattr(github, "request", fake)
    return fake


def _connect(client) -> str:
    """Start the dance and return the state GitHub would echo back."""
    res = client.get("/api/github/connect", follow_redirects=False)
    assert res.status_code == 302, res.text
    target = urlparse(res.headers["location"])
    query = parse_qs(target.query)
    assert target.netloc == "github.com"
    assert query["client_id"] == ["cid-attrappe"]
    assert query["scope"] == ["repo"]
    assert query["redirect_uri"][0].endswith("/api/github/callback")
    return query["state"][0]


def _stored_user(email="owner@example.com"):
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import User

    with Session(db_module.engine) as s:
        return s.exec(select(User).where(User.email == email)).first()


def test_unconfigured_github_is_off_and_says_so(client):
    auth(client)
    status = client.get("/api/github/status").json()
    assert status == {"configured": False, "connected": False, "login": None}
    assert client.get("/api/github/connect", follow_redirects=False).status_code == 404


def test_connecting_stores_the_token_encrypted_on_the_user_from_the_state(client, gh):
    auth(client)
    state = _connect(client)
    # GitHub's redirect back carries no Strict session cookie — prove the
    # callback does not need one.
    client.cookies.delete("cue_session")
    res = client.get(
        "/api/github/callback", params={"code": "c0de", "state": state}, follow_redirects=False
    )
    assert res.headers["location"] == "/?github=connected"

    from app import secrets_store

    user = _stored_user()
    assert user.github_login == "octo"
    assert user.github_token_enc and "token-attrappe" not in user.github_token_enc
    assert secrets_store.decrypt(user.github_token_enc) == "token-attrappe-0001"


def test_status_reports_the_connection(client, gh):
    auth(client)
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert client.get("/api/github/status").json() == {
        "configured": True,
        "connected": True,
        "login": "octo",
    }


@pytest.mark.parametrize("tamper", ["wrong-state", "", None])
def test_a_state_that_does_not_match_the_cookie_connects_nobody(client, gh, tamper):
    auth(client)
    _connect(client)
    params = {"code": "c0de"}
    if tamper is not None:
        params["state"] = tamper
    res = client.get("/api/github/callback", params=params, follow_redirects=False)
    assert res.headers["location"] == "/?github_error=state"
    assert _stored_user().github_token_enc is None
    assert not any(url == github.TOKEN_URL for _m, url in gh.calls), "no code exchange on a bad state"


def test_a_state_without_its_cookie_is_refused(client, gh):
    """An attacker's state link opened in a victim's browser: no cookie, no connect."""
    auth(client)
    state = _connect(client)
    client.cookies.delete("cue_github_state", path="/api/github")
    client.cookies.clear()
    res = client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert res.headers["location"] == "/?github_error=state"
    assert _stored_user().github_token_enc is None


def test_a_refused_consent_stores_nothing(client, gh):
    auth(client)
    state = _connect(client)
    res = client.get(
        "/api/github/callback",
        params={"error": "access_denied", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/?github_error=denied"
    assert _stored_user().github_token_enc is None


def test_disconnect_revokes_at_github_and_forgets_the_token(client, gh):
    csrf = auth(client)
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)

    res = client.delete("/api/github/connection", headers={"X-CSRF-Token": csrf})
    assert res.status_code == 204
    assert gh.revoked == {
        "body": {"access_token": "token-attrappe-0001"},
        "basic": ("cid-attrappe", "secret-attrappe"),
    }
    user = _stored_user()
    assert user.github_token_enc is None and user.github_login is None


def test_disconnect_forgets_the_token_even_when_github_refuses(client, gh):
    csrf = auth(client)
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    gh.fail["/applications/"] = github.GitHubError(0, "GitHub ist nicht erreichbar")

    assert client.delete("/api/github/connection", headers={"X-CSRF-Token": csrf}).status_code == 204
    assert _stored_user().github_token_enc is None


def test_repos_lists_what_the_account_can_read(client, gh):
    auth(client)
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert client.get("/api/github/repos").json() == [
        {"full_name": "octo/app", "default_branch": "main", "private": True}
    ]


def test_a_dead_token_is_forgotten_instead_of_failing_forever(client, gh):
    auth(client)
    state = _connect(client)
    client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    gh.fail["/user/repos"] = github.GitHubError(401, "Bad credentials")

    assert client.get("/api/github/repos").status_code == 400
    assert client.get("/api/github/status").json()["connected"] is False


def test_repos_without_a_connection_is_a_clear_400(client, gh):
    auth(client)
    res = client.get("/api/github/repos")
    assert res.status_code == 400
    assert "nicht verbunden" in res.json()["detail"]


def test_oauth_token_exchange_decodes_the_real_json_response(client, monkeypatch):
    """Mock HTTP, not request(): OAuth uses application/json, unlike API calls."""
    import io

    monkeypatch.setattr(github.urllib.request, "urlopen", lambda *args, **kw: io.BytesIO(
        b'{"access_token":"token-attrappe-json"}'
    ))
    assert github.exchange_code("code-attrappe") == "token-attrappe-json"



def test_context_refresh_shares_one_network_budget(monkeypatch):
    ticks = iter([100.0, 107.0, 111.0])
    monkeypatch.setattr(github.time, "monotonic", lambda: next(ticks))
    with github.time_budget(10):
        assert github._timeout() == 3
        with pytest.raises(github.GitHubError, match="rechtzeitig"):
            github._timeout()
    assert github._timeout() == github.TIMEOUT_S
