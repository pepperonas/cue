"""Edge/error-path tests closing the last coverage gaps.

Same conventions as test_api.py: black-box over the HTTP API with a real tmp
SQLite; external things (Google, filesystem decay, deleted users) simulated
through the same interfaces production would hit.
"""
from __future__ import annotations

import os

import pytest  # noqa: F401
from fastapi.testclient import TestClient

from conftest import CAPTURE_HDR, RUNNER_HDR, auth as _auth, make_user


def _capture_item(session_id: str, seq: int, prompt: str, cwd: str = "/Users/martin/claude/cue", **kw):
    return {"session_id": session_id, "cwd": cwd, "prompt": prompt, "seq": seq, **kw}


def _ingest(client, items):
    return client.post("/api/capture", json={"items": items}, headers=CAPTURE_HDR)


# ---------------------------------------------------------------- capture ----
def test_capture_bearer_with_empty_token_is_rejected(client):
    _auth(client)
    r = client.post(
        "/api/capture",
        json={"items": [_capture_item("s1", 1, "hi")]},
        headers={"Authorization": "Bearer "},
    )
    assert r.status_code == 401


def test_capture_skips_blank_prompts(client):
    _auth(client)
    r = _ingest(client, [_capture_item("s1", 1, "   "), _capture_item("s1", 2, "real one")])
    assert r.status_code == 200
    body = r.json()
    assert body["stored"] == 1 and body["skipped"] == 1


def test_session_without_terminal_context_is_not_deliverable(client):
    csrf = _auth(client)
    _ingest(client, [_capture_item("s-term", 1, "hello")])  # no iterm/tmux fields
    sessions = client.get("/api/sessions").json()
    assert sessions and sessions[0]["deliverable"] is False
    # ... and a send attempt is refused with 409.
    r = client.post(
        f"/api/sessions/{sessions[0]['id']}/send",
        json={"text": "x", "submit": False},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 409


def test_send_requires_nonempty_text(client):
    csrf = _auth(client)
    _ingest(client, [_capture_item("s-it", 1, "hi", iterm_session_id="w0t0p0:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")])
    sid = client.get("/api/sessions").json()[0]["id"]
    r = client.post(
        f"/api/sessions/{sid}/send",
        json={"text": "   ", "submit": False},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 400


def test_list_sessions_filters_by_project(client):
    _auth(client)
    _ingest(client, [_capture_item("s-a", 1, "a", cwd="/Users/martin/claude/cue")])
    _ingest(client, [_capture_item("s-b", 1, "b", cwd="/Users/martin/claude/ops")])
    all_sessions = client.get("/api/sessions").json()
    assert len(all_sessions) == 2
    project_ids = {s["project_id"] for s in all_sessions}
    assert len(project_ids) == 2
    one = client.get(f"/api/sessions?project_id={all_sessions[0]['project_id']}").json()
    assert len(one) == 1 and one[0]["id"] == all_sessions[0]["id"]


def test_promote_unknown_ids_404(client):
    csrf = _auth(client)
    _ingest(client, [_capture_item("s-p", 1, "promote me")])
    sid = client.get("/api/sessions").json()[0]["id"]
    hdr = {"X-CSRF-Token": csrf}
    assert client.post(f"/api/sessions/{sid}/prompts/99999/promote", headers=hdr).status_code == 404
    assert client.post(f"/api/sessions/99999/prompts/1/promote", headers=hdr).status_code == 404


def test_claim_fails_delivery_when_terminal_context_was_cleared(client):
    csrf = _auth(client)
    guid = "w0t0p0:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
    _ingest(client, [_capture_item("s-gone", 1, "hi", iterm_session_id=guid)])
    sid = client.get("/api/sessions").json()[0]["id"]
    did = client.post(
        f"/api/sessions/{sid}/send",
        json={"text": "type me", "submit": False},
        headers={"X-CSRF-Token": csrf},
    ).json()["id"]
    # The session resumes elsewhere: the next capture refresh clears the context.
    _ingest(client, [_capture_item("s-gone", 2, "resumed without terminal")])
    r = client.get("/api/cli/claim", headers=RUNNER_HDR)
    assert r.status_code == 409
    d = client.get(f"/api/cli/{did}").json()
    assert d["status"] == "failed" and "reachable" in (d["error"] or "")


def test_delivery_result_unknown_404_and_foreign_delivery_hidden(client):
    csrf = _auth(client)
    r = client.post("/api/cli/99999/result", json={"status": "sent"}, headers=RUNNER_HDR)
    assert r.status_code == 404
    assert client.get("/api/cli/99999").status_code == 404
    del csrf  # owner session established above; nothing else to assert


def test_capture_settings_regenerate_and_deleted_user(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    r = client.post("/api/capture/settings", json={"regenerate": True}, headers=hdr)
    assert r.status_code == 200
    body = r.json()
    assert body["has_token"] is True and body["token"]
    # The token is shown exactly once.
    again = client.post("/api/capture/settings", json={}, headers=hdr).json()
    assert again["has_token"] is True and again["token"] is None

    # A valid session for a since-deleted user -> 404, not a crash.
    import app.db as db_module
    from sqlmodel import Session, delete

    from app.models import User

    with Session(db_module.engine) as s:
        s.exec(delete(User))
        s.commit()
    # The tenant gate itself rejects a session whose user is gone.
    assert client.post("/api/capture/settings", json={}, headers=hdr).status_code == 401


# ------------------------------------------------------------------- runs ----
def test_single_run_rejects_two_prompts(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    a = client.post("/api/prompts", json={"body": "a"}, headers=hdr).json()["id"]
    b = client.post("/api/prompts", json={"body": "b"}, headers=hdr).json()["id"]
    r = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [a, b], "project_path": "/Users/martin/claude/cue"},
        headers=hdr,
    )
    assert r.status_code == 400


def test_get_unknown_run_404(client):
    _auth(client)
    assert client.get("/api/runs/deadbeef").status_code == 404


def test_blocked_prompt_is_not_pulled_into_running_on_run_create(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    a = client.post("/api/prompts", json={"body": "free"}, headers=hdr).json()["id"]
    b = client.post("/api/prompts", json={"body": "blocked"}, headers=hdr).json()["id"]
    client.patch(f"/api/prompts/{b}", json={"blocked": True}, headers=hdr)
    client.post(
        "/api/runs",
        json={"kind": "chain", "prompt_ids": [a, b], "project_path": "/Users/martin/claude/cue"},
        headers=hdr,
    )
    assert client.get(f"/api/prompts/{a}").json()["status"] == "running"
    assert client.get(f"/api/prompts/{b}").json()["status"] == "queued"


def test_release_after_cancel_keeps_manually_moved_prompt(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    pid = client.post("/api/prompts", json={"body": "moved meanwhile"}, headers=hdr).json()["id"]
    rid = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=hdr,
    ).json()["id"]
    # The user pulls the prompt out of Running by hand while the run is queued.
    client.patch(f"/api/prompts/{pid}", json={"status": "done"}, headers=hdr)
    client.post(f"/api/runs/{rid}/cancel", headers=hdr)
    # Cancel must NOT drag the manually-moved prompt back into the queue.
    assert client.get(f"/api/prompts/{pid}").json()["status"] == "done"


def test_heartbeat_on_terminal_run_reports_status_without_reviving(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    pid = client.post("/api/prompts", json={"body": "hb"}, headers=hdr).json()["id"]
    rid = client.post(
        "/api/runs",
        json={"kind": "single", "prompt_ids": [pid], "project_path": "/Users/martin/claude/cue"},
        headers=hdr,
    ).json()["id"]
    client.post("/api/runs/claim", json={}, headers=RUNNER_HDR)
    client.post(f"/api/runs/{rid}/result", json={"status": "canceled"}, headers=RUNNER_HDR)
    hb = client.post(f"/api/runs/{rid}/heartbeat", headers=RUNNER_HDR)
    assert hb.status_code == 200 and hb.json()["status"] == "canceled"


# ---------------------------------------------------------------- prompts ----
def test_list_prompts_server_side_filters(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    proj = client.post("/api/projects", json={"name": "filterme", "color": "#123456"}, headers=hdr).json()["id"]
    client.post("/api/prompts", json={"body": "Grüße aus Berlin", "project_id": proj}, headers=hdr)
    client.post("/api/prompts", json={"body": "unrelated"}, headers=hdr)
    assert len(client.get(f"/api/prompts?project_id={proj}").json()) == 1
    assert len(client.get("/api/prompts?q=Grüße").json()) == 1
    assert len(client.get("/api/prompts?q=nothing-matches").json()) == 0


def test_update_prompt_project_assignment_branches(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    proj = client.post("/api/projects", json={"name": "target", "color": "#654321"}, headers=hdr).json()["id"]
    pid = client.post("/api/prompts", json={"body": "assign me"}, headers=hdr).json()["id"]
    ok = client.patch(f"/api/prompts/{pid}", json={"project_id": proj}, headers=hdr)
    assert ok.status_code == 200 and ok.json()["project_id"] == proj
    bad = client.patch(f"/api/prompts/{pid}", json={"project_id": 99999}, headers=hdr)
    assert bad.status_code == 400


def test_duplicate_skips_attachment_whose_file_expired(client, tmp_path):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    import io

    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
    att = client.post(
        "/api/attachments",
        files={"file": ("shot.png", io.BytesIO(png), "image/png")},
        headers=hdr,
    ).json()
    pid = client.post(
        "/api/prompts", json={"body": "with shot", "attachment_ids": [att["id"]]}, headers=hdr
    ).json()["id"]
    # Simulate the 30-day GC having removed the file from disk. The dir must
    # come from the module's cached _settings (see CLAUDE.md gotcha), not env.
    from app.routers.attachments import _settings as att_settings

    attachments_dir = att_settings.attachments_dir
    for name in os.listdir(attachments_dir):
        os.remove(os.path.join(attachments_dir, name))
    copy = client.post(f"/api/prompts/{pid}/duplicate", json={}, headers=hdr)
    assert copy.status_code == 201
    assert copy.json()["attachments"] == []  # missing file skipped, no crash


def test_merge_archive_leaves_already_archived_sources_alone(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    a = client.post("/api/prompts", json={"body": "one"}, headers=hdr).json()["id"]
    b = client.post("/api/prompts", json={"body": "two"}, headers=hdr).json()["id"]
    client.patch(f"/api/prompts/{b}", json={"status": "archived"}, headers=hdr)
    b_order = client.get(f"/api/prompts/{b}").json()["sort_order"]
    r = client.post(
        "/api/prompts/merge",
        json={"source_ids": [a, b], "title": "m", "body": "one\n\ntwo", "status": "queued",
              "tags": "", "originals": "archive"},
        headers=hdr,
    )
    assert r.status_code == 201
    merged_b = client.get(f"/api/prompts/{b}").json()
    assert merged_b["status"] == "archived" and merged_b["sort_order"] == b_order


def test_bookmark_reorder_ignores_foreign_prompts(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    mine = client.post("/api/prompts", json={"body": "mine"}, headers=hdr).json()["id"]
    client.patch(f"/api/prompts/{mine}", json={"bookmarked": True}, headers=hdr)

    theirs_uid = make_user("other@example.com")
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    with Session(db_module.engine) as s:
        theirs = Prompt(user_id=theirs_uid, title="t", body="t", bookmarked=True)
        s.add(theirs)
        s.commit()
        s.refresh(theirs)
        theirs_id = theirs.id

    r = client.post(
        "/api/prompts/bookmarks/reorder",
        json={"items": [
            {"id": mine, "bookmark_order": 5},
            {"id": theirs_id, "bookmark_order": 1},
        ]},
        headers=hdr,
    )
    assert r.status_code == 200
    assert [p["id"] for p in r.json()] == [mine]  # foreign row untouched/absent

    with Session(db_module.engine) as s:
        assert s.get(Prompt, theirs_id).bookmark_order != 1


# ------------------------------------------------------------- attachments ----
def test_attachment_serve_404_when_file_vanished(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    import io

    att = client.post(
        "/api/attachments",
        files={"file": ("gone.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 30), "image/png")},
        headers=hdr,
    ).json()
    from app.routers.attachments import _settings as att_settings

    attachments_dir = att_settings.attachments_dir
    for name in os.listdir(attachments_dir):
        os.remove(os.path.join(attachments_dir, name))
    assert client.get(f"/api/attachments/{att['id']}").status_code == 404


def test_purge_expired_tolerates_already_deleted_files(client):
    csrf = _auth(client)
    hdr = {"X-CSRF-Token": csrf}
    import datetime as dt
    import io

    att = client.post(
        "/api/attachments",
        files={"file": ("old.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 30), "image/png")},
        headers=hdr,
    ).json()
    from app.routers.attachments import _settings as att_settings

    attachments_dir = att_settings.attachments_dir
    for name in os.listdir(attachments_dir):
        os.remove(os.path.join(attachments_dir, name))

    import app.db as db_module
    from sqlmodel import Session

    from app.models import Attachment
    from app.routers.attachments import purge_expired

    with Session(db_module.engine) as s:
        row = s.get(Attachment, att["id"])
        row.created_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90)
        s.add(row)
        s.commit()
        purge_expired(s)
        assert s.get(Attachment, att["id"]) is None  # row gone despite missing file


# ---------------------------------------------------- deps/security/infra ----
def test_session_with_non_int_uid_is_unauthenticated(client):
    from app import security

    forged = security._serializer().dumps({"uid": "not-an-int", "csrf": "x"})
    client.cookies.set("cue_session", forged)
    assert client.get("/api/prompts").status_code == 401


def test_read_session_swallows_exotic_token_types():
    from app.security import read_session

    assert read_session(12345) is None  # type: ignore[arg-type]
    assert read_session(b"\xff\xfe") is None  # type: ignore[arg-type]


def test_runner_endpoints_unconfigured_token(client, monkeypatch):
    from app import deps

    monkeypatch.setattr(deps._settings, "runner_token", "")
    r = client.post("/api/runs/claim", json={}, headers=RUNNER_HDR)
    assert r.status_code == 401
    assert "not configured" in r.json()["detail"]


def test_init_db_is_idempotent(client):
    import app.db as db_module

    db_module.init_db()
    db_module.init_db()  # second run: every ALTER guarded, no error
    assert client.get("/api/health").json() == {"status": "ok"}


def test_auth_http_helpers_build_requests(monkeypatch):
    """_post_form/_get_json: form encoding, headers, JSON parsing (urlopen faked)."""
    import io as _io
    import json as _json

    from app.routers import auth as auth_module

    captured: dict = {}

    class FakeResp:
        def __init__(self, payload):
            self._payload = payload

        def read(self):
            return _json.dumps(self._payload).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["headers"] = dict(req.header_items())
        captured["data"] = req.data
        return FakeResp({"ok": True, "echo": "ümlaut"})

    monkeypatch.setattr(auth_module.urllib.request, "urlopen", fake_urlopen)

    out = auth_module._post_form("https://example.test/token", {"a": "b c", "ü": "x"})
    assert out["ok"] is True and out["echo"] == "ümlaut"
    assert captured["method"] == "POST"
    assert b"a=b+c" in captured["data"]
    assert captured["headers"].get("Content-type") == "application/x-www-form-urlencoded"

    out = auth_module._get_json("https://example.test/userinfo", "tok-123")
    assert out["ok"] is True
    assert captured["method"] == "GET"
    assert captured["headers"].get("Authorization") == "Bearer tok-123"


def test_spa_missing_index_and_missing_static_dir(tmp_path):
    """SPA branch without index.html -> 404 JSON; no static dir -> dev hint route."""
    import importlib

    from app import config

    def _mk_client(static_dir):
        os.environ["STATIC_DIR"] = str(static_dir)
        os.environ["DB_PATH"] = str(tmp_path / "cue.db")
        os.environ["UPLOAD_DIR"] = str(tmp_path / "uploads")
        os.environ["ATTACHMENTS_DIR"] = str(tmp_path / "attachments")
        config.get_settings.cache_clear()
        import app.db as db_module

        importlib.reload(db_module)
        import app.main as main_module

        importlib.reload(main_module)
        return TestClient(main_module.app)

    empty_static = tmp_path / "static-without-index"
    (empty_static / "assets").mkdir(parents=True)
    try:
        with _mk_client(empty_static) as c:
            r = c.get("/some/route")
            assert r.status_code == 404 and r.json()["detail"] == "Frontend not built"
        with _mk_client(tmp_path / "does-not-exist") as c:
            r = c.get("/")
            assert r.status_code == 200 and "Frontend not built" in r.json()["detail"]
    finally:
        os.environ.pop("STATIC_DIR", None)
        config.get_settings.cache_clear()


# ------------------------------------------------------------- user approval ----
def _login_pending(client, email="pending@example.com"):
    """A user who signed in but is not approved (created directly, like the
    OAuth callback would for a non-allowlisted email)."""
    import app.db as db_module
    from sqlmodel import Session

    from app import security
    from app.models import User

    with Session(db_module.engine) as s:
        user = User(google_sub=f"sub-{email}", email=email, name="Pending", approved=False)
        s.add(user)
        s.commit()
        s.refresh(user)
        uid = user.id
    token = security.issue_session(uid)
    client.cookies.set("cue_session", token)
    return uid, security.csrf_from_session(token)


def test_pending_user_is_locked_out_until_approved(client):
    uid, csrf = _login_pending(client)
    me = client.get("/api/auth/me").json()
    assert me["authenticated"] is True and me["approved"] is False and me["is_admin"] is False
    # No data access while pending — reads and writes alike.
    assert client.get("/api/prompts").status_code == 403
    assert (
        client.post("/api/prompts", json={"body": "x"}, headers={"X-CSRF-Token": csrf}).status_code
        == 403
    )
    # ... but logout still works.
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200


def test_admin_approves_and_revokes(client):
    pending_uid, pending_csrf = _login_pending(client)
    pending_cookie = client.cookies.get("cue_session")

    owner_csrf = _auth(client)  # owner@example.com == OWNER_EMAIL in tests
    owner_cookie = client.cookies.get("cue_session")
    me = client.get("/api/auth/me").json()
    assert me["is_admin"] is True

    users = client.get("/api/admin/users").json()
    target = next(u for u in users if u["id"] == pending_uid)
    assert target["approved"] is False

    r = client.patch(
        f"/api/admin/users/{pending_uid}",
        json={"approved": True},
        headers={"X-CSRF-Token": owner_csrf},
    )
    assert r.status_code == 200 and r.json()["approved"] is True

    # The approved user gets access with their EXISTING session.
    client.cookies.set("cue_session", pending_cookie)
    assert client.get("/api/prompts").status_code == 200
    assert client.get("/api/auth/me").json()["approved"] is True

    # Revoke -> locked out again on the next request.
    client.cookies.set("cue_session", owner_cookie)
    client.patch(
        f"/api/admin/users/{pending_uid}",
        json={"approved": False},
        headers={"X-CSRF-Token": owner_csrf},
    )
    client.cookies.set("cue_session", pending_cookie)
    assert client.get("/api/prompts").status_code == 403
    del pending_csrf


def test_admin_endpoints_owner_only_and_self_lockout_blocked(client):
    _login_pending(client, "someone@example.com")
    # Pending/non-owner users cannot reach the admin API.
    assert client.get("/api/admin/users").status_code == 403

    owner_csrf = _auth(client)
    me = client.get("/api/auth/me").json()
    assert me["is_admin"] is True
    my_id = next(
        u["id"] for u in client.get("/api/admin/users").json() if u["email"] == "owner@example.com"
    )
    r = client.patch(
        f"/api/admin/users/{my_id}",
        json={"approved": False},
        headers={"X-CSRF-Token": owner_csrf},
    )
    assert r.status_code == 400  # cannot lock out yourself
