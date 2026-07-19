"""Snippet sync with Inspector Rust: token auth, scope, merge rules, tombstones.

Black-box over the HTTP API like the rest of the suite. The "IR side" is
simulated by calling the sync endpoints the way the IR client does (pull then
push) — the convergence test at the bottom runs a full two-party cycle.
"""
from __future__ import annotations

from conftest import auth as _auth


def _setup(client, *, synced_group: str = "AI Prompts") -> tuple[str, dict, int]:
    """Login, mint a sync token, create one SYNCED group. Returns
    (csrf, bearer-header, group_id)."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    token = client.post(
        "/api/sync/settings", json={"regenerate": True}, headers=headers
    ).json()["token"]
    group = client.post(
        "/api/snippets/groups", json={"name": synced_group}, headers=headers
    ).json()
    client.patch(
        f"/api/snippets/groups/{group['id']}", json={"synced": True}, headers=headers
    )
    return csrf, {"Authorization": f"Bearer {token}"}, group["id"]


def _snippet(client, csrf, abbreviation, body="b", group="AI Prompts", title=""):
    return client.post(
        "/api/snippets",
        json={"abbreviation": abbreviation, "title": title, "body": body, "group_name": group},
        headers={"X-CSRF-Token": csrf},
    ).json()


def test_sync_requires_valid_token(client):
    csrf = _auth(client)
    assert client.get("/api/sync/snippets").status_code == 401
    assert client.get(
        "/api/sync/snippets", headers={"Authorization": "Bearer nope"}
    ).status_code == 401
    assert client.post(
        "/api/sync/snippets", json={}, headers={"Authorization": "Bearer nope"}
    ).status_code == 401
    # Settings need the cookie session, not the token.
    st = client.get("/api/sync/settings")
    assert st.status_code == 200 and st.json()["has_token"] is False
    tok = client.post("/api/sync/settings", json={"regenerate": True},
                      headers={"X-CSRF-Token": csrf}).json()
    assert tok["has_token"] is True and len(tok["token"]) == 64
    # Token shown exactly once.
    assert client.get("/api/sync/settings").json()["token"] is None


def test_pull_scope_groups_and_ungrouped_flag(client):
    csrf, bearer, _gid = _setup(client)
    headers = {"X-CSRF-Token": csrf}
    # A second, NOT-synced group + an ungrouped snippet.
    client.post("/api/snippets/groups", json={"name": "Privat"}, headers=headers)
    _snippet(client, csrf, "aiplan", body="plan", group="AI Prompts")
    _snippet(client, csrf, "geheim", body="x", group="Privat")
    _snippet(client, csrf, "solo", body="y", group="")

    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert pull["groups"] == ["AI Prompts"]
    assert pull["sync_ungrouped"] is False
    assert [s["abbreviation"] for s in pull["snippets"]] == ["aiplan"]
    assert pull["snippets"][0]["category"] == "AI Prompts"
    assert pull["snippets"][0]["version"] == 1

    # Enable ungrouped sync -> the ungrouped snippet joins the scope.
    client.post("/api/sync/settings", json={"sync_ungrouped": True}, headers=headers)
    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert {s["abbreviation"] for s in pull["snippets"]} == {"aiplan", "solo"}
    # last_sync is stamped by the pull.
    assert client.get("/api/sync/settings").json()["last_sync"] is not None


def test_push_merge_rules(client):
    csrf, bearer, _gid = _setup(client)

    def push(**item):
        payload = {"snippets": [{"category": "AI Prompts", "title": "", **item}]}
        return client.post("/api/sync/snippets", json=payload, headers=bearer).json()

    # New snippet from IR -> created with its version.
    r = push(abbreviation="airev", body="review", version=3)
    assert r["created"] == 1
    snippets = client.get("/api/snippets").json()
    row = next(s for s in snippets if s["abbreviation"] == "airev")
    assert row["version"] == 3 and row["group_name"] == "AI Prompts"

    # Same version + identical content -> no-op.
    assert push(abbreviation="airev", body="review", version=3)["unchanged"] == 1
    # Same version + different content -> cue wins the tie.
    r = push(abbreviation="airev", body="DIFFERENT", version=3)
    assert r["kept_local"] == 1
    assert client.get("/api/snippets").json()[0]["body"] == "review"
    # Lower version -> kept local.
    assert push(abbreviation="airev", body="old", version=2)["kept_local"] == 1
    # Higher version -> content updated.
    r = push(abbreviation="airev", body="review v4", version=4)
    assert r["updated"] == 1
    row = client.get("/api/snippets").json()[0]
    assert row["body"] == "review v4" and row["version"] == 4

    # Out-of-scope category -> ignored, nothing created.
    r = push(abbreviation="foreign", body="x", version=1, category="Privat")
    assert r["ignored"] == 1
    assert len(client.get("/api/snippets").json()) == 1


def test_push_keeps_cue_grouping_for_existing(client):
    """cue is the organizational master: an incoming category never moves an
    existing snippet; content still follows the higher version."""
    csrf, bearer, _gid = _setup(client)
    headers = {"X-CSRF-Token": csrf}
    other = client.post("/api/snippets/groups", json={"name": "Zwei"}, headers=headers).json()
    client.patch(f"/api/snippets/groups/{other['id']}", json={"synced": True}, headers=headers)
    _snippet(client, csrf, "aimove", body="v1", group="AI Prompts")

    r = client.post(
        "/api/sync/snippets",
        json={"snippets": [
            {"abbreviation": "aimove", "title": "", "body": "v2", "category": "Zwei", "version": 2}
        ]},
        headers=bearer,
    ).json()
    assert r["updated"] == 1
    row = client.get("/api/snippets").json()[0]
    assert row["body"] == "v2" and row["group_name"] == "AI Prompts"


def test_delete_produces_tombstone_and_recreate_lands_above_it(client):
    csrf, bearer, _gid = _setup(client)
    headers = {"X-CSRF-Token": csrf}
    s = _snippet(client, csrf, "aigone", body="b")
    # Bump to v2, then delete.
    client.patch(f"/api/snippets/{s['id']}", json={"body": "b2"}, headers=headers)
    client.delete(f"/api/snippets/{s['id']}", headers=headers)

    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert pull["snippets"] == []
    assert [(t["abbreviation"], t["version"]) for t in pull["tombstones"]] == [("aigone", 2)]

    # Recreating starts ABOVE the tombstone and clears it.
    s2 = _snippet(client, csrf, "aigone", body="new")
    assert s2["version"] == 3
    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert pull["tombstones"] == []
    assert pull["snippets"][0]["version"] == 3


def test_incoming_tombstone_deletes_unless_local_is_newer(client):
    csrf, bearer, _gid = _setup(client)
    headers = {"X-CSRF-Token": csrf}
    a = _snippet(client, csrf, "aidel", body="b")  # v1
    b = _snippet(client, csrf, "aikeep", body="b")  # v1
    client.patch(f"/api/snippets/{b['id']}", json={"body": "edited"}, headers=headers)  # v2

    r = client.post(
        "/api/sync/snippets",
        json={"tombstones": [
            {"abbreviation": "aidel", "version": 1, "deleted_at_ms": 0},
            {"abbreviation": "aikeep", "version": 1, "deleted_at_ms": 0},
        ]},
        headers=bearer,
    ).json()
    assert r["deleted"] == 1 and r["kept_local"] == 1
    remaining = {s["abbreviation"] for s in client.get("/api/snippets").json()}
    assert remaining == {"aikeep"}  # the local edit beat the deletion

    # A pushed snippet at/below a stored tombstone is ignored; above it resurrects.
    low = client.post(
        "/api/sync/snippets",
        json={"snippets": [
            {"abbreviation": "aidel", "title": "", "body": "x", "category": "AI Prompts", "version": 1}
        ]},
        headers=bearer,
    ).json()
    assert low["ignored"] == 1
    high = client.post(
        "/api/sync/snippets",
        json={"snippets": [
            {"abbreviation": "aidel", "title": "", "body": "x", "category": "AI Prompts", "version": 2}
        ]},
        headers=bearer,
    ).json()
    assert high["created"] == 1
    assert client.get("/api/sync/snippets", headers=bearer).json()["tombstones"] == []


def test_rename_tombstones_the_old_abbreviation(client):
    csrf, bearer, _gid = _setup(client)
    s = _snippet(client, csrf, "aiold", body="b")
    client.patch(
        f"/api/snippets/{s['id']}", json={"abbreviation": "ainew"},
        headers={"X-CSRF-Token": csrf},
    )
    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert [t["abbreviation"] for t in pull["tombstones"]] == ["aiold"]
    assert [s["abbreviation"] for s in pull["snippets"]] == ["ainew"]
    # Renaming back resurrects above the old tombstone (round-trip safe).
    client.patch(
        f"/api/snippets/{s['id']}", json={"abbreviation": "aiold"},
        headers={"X-CSRF-Token": csrf},
    )
    pull = client.get("/api/sync/snippets", headers=bearer).json()
    assert [t["abbreviation"] for t in pull["tombstones"]] == ["ainew"]
    row = pull["snippets"][0]
    assert row["abbreviation"] == "aiold" and row["version"] >= 2


def test_sync_is_tenant_scoped(client):
    csrf, bearer, _gid = _setup(client)
    _snippet(client, csrf, "aimine", body="b")
    # A second user with their own token sees nothing of user A.
    csrf_b = _auth(client, email="b@example.com", sub="sub-b")
    token_b = client.post(
        "/api/sync/settings", json={"regenerate": True}, headers={"X-CSRF-Token": csrf_b}
    ).json()["token"]
    pull_b = client.get(
        "/api/sync/snippets", headers={"Authorization": f"Bearer {token_b}"}
    ).json()
    assert pull_b["groups"] == [] and pull_b["snippets"] == []
    # And user A's pull still works, unchanged.
    pull_a = client.get("/api/sync/snippets", headers=bearer).json()
    assert [s["abbreviation"] for s in pull_a["snippets"]] == ["aimine"]


def test_two_party_cycle_converges(client):
    """Full IR-style sync cycle simulated twice: after cycle 1 both sides are
    identical; cycle 2 is a complete no-op (no ping-pong, no version creep)."""
    csrf, bearer, _gid = _setup(client)
    headers = {"X-CSRF-Token": csrf}
    _snippet(client, csrf, "aicue", body="from cue")

    # "IR" local store: one own snippet + one that will conflict later.
    ir: dict[str, dict] = {
        "airust": {"title": "", "body": "from ir", "category": "AI Prompts", "version": 1},
    }

    def cycle():
        changed = 0
        pull = client.get("/api/sync/snippets", headers=bearer).json()
        for ts in pull["tombstones"]:
            local = ir.get(ts["abbreviation"])
            if local and local["version"] <= ts["version"]:
                del ir[ts["abbreviation"]]
                changed += 1
        for item in pull["snippets"]:
            local = ir.get(item["abbreviation"])
            incoming = {k: item[k] for k in ("title", "body", "category", "version")}
            if local is None:
                ir[item["abbreviation"]] = incoming
                changed += 1
            elif item["version"] > local["version"] or (
                item["version"] == local["version"] and incoming != local
            ):
                # higher version wins; on a tie cue wins (content AND grouping)
                ir[item["abbreviation"]] = incoming
                if incoming != local:
                    changed += 1
        push_payload = {
            "snippets": [{"abbreviation": k, **v} for k, v in ir.items()],
            "tombstones": [],
        }
        result = client.post("/api/sync/snippets", json=push_payload, headers=bearer).json()
        return changed, result

    changed, result = cycle()
    assert changed == 1  # IR gained "aicue"
    assert result["created"] == 1  # cue gained "airust"
    changed, result = cycle()
    assert changed == 0
    assert result["created"] == 0 and result["updated"] == 0 and result["deleted"] == 0
    assert result["unchanged"] == 2  # fully converged, stable
