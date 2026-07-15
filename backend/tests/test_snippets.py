"""Snippet library API: CRUD, groups, tenant isolation, IR import/export.

Black-box over the HTTP API with a tmp SQLite (fixtures from conftest.py).
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest  # noqa: F401

from conftest import auth as _auth

FIXTURE = Path(__file__).parent / "fixtures" / "ir-backup-snippets.json"


def _hdr(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}


def _mk(client, hdr, abbreviation, body="expansion text", **kw):
    r = client.post(
        "/api/snippets", json={"abbreviation": abbreviation, "body": body, **kw}, headers=hdr
    )
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------- CRUD ----
def test_snippet_crud_flow(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)

    s = _mk(client, hdr, "aix", title="Titel", body="Körper mit Ümlauten 👋",
            group_name="AI Prompts")
    assert s["group_name"] == "AI Prompts" and s["sort_order"] == 1
    # Assigning an unknown group creates it on the fly.
    groups = client.get("/api/snippets/groups").json()
    assert [g["name"] for g in groups] == ["AI Prompts"]

    got = client.get(f"/api/snippets/{s['id']}").json()
    assert got["body"] == "Körper mit Ümlauten 👋"

    upd = client.patch(
        f"/api/snippets/{s['id']}",
        json={"title": "Neu", "body": "anders", "group_name": ""},
        headers=hdr,
    )
    assert upd.status_code == 200
    assert upd.json()["title"] == "Neu" and upd.json()["group_name"] is None  # "" ungroups

    # group_name absent -> assignment untouched.
    upd2 = client.patch(f"/api/snippets/{s['id']}", json={"title": "Nur Titel"}, headers=hdr)
    assert upd2.json()["group_name"] is None

    assert client.delete(f"/api/snippets/{s['id']}", headers=hdr).status_code == 204
    assert client.get(f"/api/snippets/{s['id']}").status_code == 404


def test_snippet_validation_and_unique_abbreviation_per_user(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    _mk(client, hdr, "dup")
    r = client.post("/api/snippets", json={"abbreviation": "dup", "body": "x"}, headers=hdr)
    assert r.status_code == 409
    # Trim-only on the abbreviation: " dup " collides with "dup".
    r = client.post("/api/snippets", json={"abbreviation": " dup ", "body": "x"}, headers=hdr)
    assert r.status_code == 409
    assert client.post("/api/snippets", json={"abbreviation": "", "body": "x"}, headers=hdr).status_code == 400
    assert client.post("/api/snippets", json={"abbreviation": "a", "body": " "}, headers=hdr).status_code == 400
    # Rename onto an existing abbreviation -> 409; onto itself -> fine.
    other = _mk(client, hdr, "other")
    assert client.patch(f"/api/snippets/{other['id']}", json={"abbreviation": "dup"}, headers=hdr).status_code == 409
    assert client.patch(f"/api/snippets/{other['id']}", json={"abbreviation": "other"}, headers=hdr).status_code == 200


def test_snippet_tenant_isolation(client):
    csrf_a = _auth(client, "a@example.com")
    sid = _mk(client, _hdr(csrf_a), "mine")["id"]

    csrf_b = _auth(client, "b@example.com")  # switches the session cookie
    hdr_b = _hdr(csrf_b)
    assert client.get("/api/snippets").json() == []
    assert client.get(f"/api/snippets/{sid}").status_code == 404
    assert client.patch(f"/api/snippets/{sid}", json={"title": "steal"}, headers=hdr_b).status_code == 404
    assert client.delete(f"/api/snippets/{sid}", headers=hdr_b).status_code == 404
    # Same abbreviation is fine for another tenant (per-user uniqueness).
    assert client.post("/api/snippets", json={"abbreviation": "mine", "body": "x"}, headers=hdr_b).status_code == 201


# ----------------------------------------------------------------- groups ----
def test_group_crud_rename_backfills_and_delete_ungroups(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    g = client.post("/api/snippets/groups", json={"name": "Alt"}, headers=hdr).json()
    assert client.post("/api/snippets/groups", json={"name": "Alt"}, headers=hdr).status_code == 409
    assert client.post("/api/snippets/groups", json={"name": "  "}, headers=hdr).status_code == 400

    s = _mk(client, hdr, "member", group_name="Alt")

    # Rename back-fills the denormalized group_name.
    r = client.patch(f"/api/snippets/groups/{g['id']}", json={"name": "Neu"}, headers=hdr)
    assert r.status_code == 200
    assert client.get(f"/api/snippets/{s['id']}").json()["group_name"] == "Neu"

    # Deleting the group keeps the snippet, now ungrouped.
    assert client.delete(f"/api/snippets/groups/{g['id']}", headers=hdr).status_code == 204
    assert client.get(f"/api/snippets/{s['id']}").json()["group_name"] is None
    assert client.get("/api/snippets/groups").json() == []


def test_group_reorder_and_foreign_group_404(client):
    csrf = _auth(client, "a@example.com")
    hdr = _hdr(csrf)
    g1 = client.post("/api/snippets/groups", json={"name": "Eins"}, headers=hdr).json()
    g2 = client.post("/api/snippets/groups", json={"name": "Zwei"}, headers=hdr).json()
    client.post(
        "/api/snippets/groups/reorder",
        json={"items": [{"id": g2["id"], "sort_order": 1}, {"id": g1["id"], "sort_order": 2}]},
        headers=hdr,
    )
    assert [g["name"] for g in client.get("/api/snippets/groups").json()] == ["Zwei", "Eins"]

    csrf_b = _auth(client, "b@example.com")
    assert client.patch(
        f"/api/snippets/groups/{g1['id']}", json={"name": "x"}, headers=_hdr(csrf_b)
    ).status_code == 404


def test_reorder_bulk_move_bulk_delete(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    a = _mk(client, hdr, "a")
    b = _mk(client, hdr, "b")
    c = _mk(client, hdr, "c")

    # Drag: a into group G at position 1, b to ungrouped position 1.
    client.post(
        "/api/snippets/reorder",
        json={"items": [
            {"id": a["id"], "group_name": "G", "sort_order": 1},
            {"id": b["id"], "group_name": "", "sort_order": 1},
        ]},
        headers=hdr,
    )
    assert client.get(f"/api/snippets/{a['id']}").json()["group_name"] == "G"
    assert client.get(f"/api/snippets/{b['id']}").json()["group_name"] is None

    # Bulk move b+c into G, then bulk delete them.
    moved = client.post(
        "/api/snippets/bulk-move",
        json={"ids": [b["id"], c["id"]], "group_name": "G"},
        headers=hdr,
    ).json()
    assert {m["group_name"] for m in moved} == {"G"}
    client.post("/api/snippets/bulk-delete", json={"ids": [b["id"], c["id"]]}, headers=hdr)
    remaining = [s["abbreviation"] for s in client.get("/api/snippets").json()]
    assert remaining == ["a"]


# ---------------------------------------------------------- import/export ----
def test_import_fixture_and_merge_semantics(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    raw = FIXTURE.read_bytes()

    r = client.post(
        "/api/snippets/import",
        files={"file": ("backup.json", io.BytesIO(raw), "application/json")},
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["imported"] == 28 and res["updated"] == 0
    assert res["groups_created"] == 2  # AI Prompts + the EMPTY Scratch
    assert res["skipped"] == 0 and res["errors"] == []

    # Second import of the same file: everything merges as updates.
    res2 = client.post(
        "/api/snippets/import",
        files={"file": ("backup.json", io.BytesIO(raw), "application/json")},
        headers=hdr,
    ).json()
    assert res2["imported"] == 0 and res2["updated"] == 28 and res2["groups_created"] == 0

    # category:null in the fixture ("loose") must not clobber a cue-side move.
    loose = next(s for s in client.get("/api/snippets").json() if s["abbreviation"] == "loose")
    client.patch(f"/api/snippets/{loose['id']}", json={"group_name": "Scratch"}, headers=hdr)
    client.post(
        "/api/snippets/import",
        files={"file": ("backup.json", io.BytesIO(raw), "application/json")},
        headers=hdr,
    )
    assert client.get(f"/api/snippets/{loose['id']}").json()["group_name"] == "Scratch"


def test_import_json_body_and_error_paths(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    # Raw JSON body (no multipart): the legacy list format.
    r = client.post(
        "/api/snippets/import",
        content=json.dumps([{"abbreviation": "legacy", "body": "b"}]),
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert r.status_code == 200 and r.json()["imported"] == 1

    enc = json.dumps({"encrypted": True, "kdf": "argon2id"})
    r = client.post(
        "/api/snippets/import",
        content=enc,
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert r.status_code == 400 and "unverschlüsselt" in r.json()["detail"]

    r = client.post(
        "/api/snippets/import",
        content="{broken",
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert r.status_code == 400

    # Per-row errors are collected, not fatal.
    partial = json.dumps({"version": 2, "snippets": [
        {"abbreviation": "", "body": "x"}, {"abbreviation": "ok", "body": "y"},
    ]})
    res = client.post(
        "/api/snippets/import",
        content=partial,
        headers={**hdr, "Content-Type": "application/json"},
    ).json()
    assert res["imported"] == 1 and res["skipped"] == 1 and len(res["errors"]) == 1


def test_export_headers_partial_export_and_empty_groups(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    _mk(client, hdr, "one", group_name="G1")
    _mk(client, hdr, "two", group_name="G2")
    client.post("/api/snippets/groups", json={"name": "Leer"}, headers=hdr)

    r = client.get("/api/snippets/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert 'attachment; filename="ir-snippets-' in r.headers["content-disposition"]
    doc = r.json()
    assert doc["version"] == 2
    assert [c["name"] for c in doc["snippet_categories"]] == ["G1", "G2", "Leer"]

    # Partial export by group.
    part = client.get("/api/snippets/export?groups=G1").json()
    assert [s["abbreviation"] for s in part["snippets"]] == ["one"]
    assert [c["name"] for c in part["snippet_categories"]] == ["G1"]


def test_golden_roundtrip_against_ir_fixture(client):
    """Import the real IR fixture, edit nothing, export — the result must be
    semantically identical modulo exported_at/id/updated_at."""
    csrf = _auth(client)
    hdr = _hdr(csrf)
    original = json.loads(FIXTURE.read_text())
    client.post(
        "/api/snippets/import",
        files={"file": ("backup.json", io.BytesIO(FIXTURE.read_bytes()), "application/json")},
        headers=_hdr(csrf),
    )
    exported = client.get("/api/snippets/export").json()

    assert exported["version"] == 2
    assert exported["history"] == [] and exported["notes"] == []
    assert exported["totp_entries"] == [] and exported["settings"] == {}

    # Same abbreviation set, char-exact bodies.
    orig_by_abbr = {s["abbreviation"]: s for s in original["snippets"]}
    exp_by_abbr = {s["abbreviation"]: s for s in exported["snippets"]}
    assert set(exp_by_abbr) == set(orig_by_abbr)
    for abbr, s in exp_by_abbr.items():
        assert s["body"] == orig_by_abbr[abbr]["body"], abbr
        assert s["title"] == (orig_by_abbr[abbr].get("title") or ""), abbr
        # created_at millis survive the roundtrip.
        assert s["created_at"] == int(orig_by_abbr[abbr]["created_at"])

    # Same group assignment: null in the source materializes as "" (ungrouped).
    for abbr, s in exp_by_abbr.items():
        orig_cat = orig_by_abbr[abbr].get("category")
        assert s["category"] == (orig_cat or ""), abbr

    # The deliberately EMPTY group survives, order preserved.
    assert [c["name"] for c in exported["snippet_categories"]] == ["AI Prompts", "Scratch"]

    hdr = _hdr(csrf)  # noqa: F841 (symmetry with other tests)


def test_snippet_version_bumps_on_content_change_only(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    s = _mk(client, hdr, "ver", body="v1 body")
    assert s["version"] == 1  # new snippets start at v1

    # Content changes bump: body, title, abbreviation.
    r = client.patch(f"/api/snippets/{s['id']}", json={"body": "v2 body"}, headers=hdr)
    assert r.json()["version"] == 2
    r = client.patch(f"/api/snippets/{s['id']}", json={"title": "Neuer Titel"}, headers=hdr)
    assert r.json()["version"] == 3
    r = client.patch(f"/api/snippets/{s['id']}", json={"abbreviation": "ver2"}, headers=hdr)
    assert r.json()["version"] == 4

    # No-op save (same values) does NOT bump.
    r = client.patch(
        f"/api/snippets/{s['id']}",
        json={"body": "v2 body", "title": "Neuer Titel", "abbreviation": "ver2"},
        headers=hdr,
    )
    assert r.json()["version"] == 4

    # Organizational changes (group move, reorder) do NOT bump.
    r = client.patch(f"/api/snippets/{s['id']}", json={"group_name": "G"}, headers=hdr)
    assert r.json()["version"] == 4
    client.post(
        "/api/snippets/reorder",
        json={"items": [{"id": s["id"], "group_name": "G", "sort_order": 3}]},
        headers=hdr,
    )
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 4


def test_snippet_version_bumps_on_import_merge_content_change(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    s = _mk(client, hdr, "imp", body="original")
    doc = {"version": 2, "snippets": [{"abbreviation": "imp", "title": "", "body": "changed"}]}
    client.post(
        "/api/snippets/import",
        content=json.dumps(doc),
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 2
    # Identical re-import: updated counts, but no version bump.
    doc["snippets"][0]["body"] = "changed"
    client.post(
        "/api/snippets/import",
        content=json.dumps(doc),
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 2


def test_version_merge_rule_matches_ir_protocol(client):
    """Shared cue<->IR rule: content differs -> max(incoming, local+1);
    identical -> max(incoming, local); missing incoming -> 1."""
    csrf = _auth(client)
    hdr = _hdr(csrf)

    def imp(items):
        doc = {"version": 2, "snippets": items}
        return client.post(
            "/api/snippets/import",
            content=json.dumps(doc),
            headers={**hdr, "Content-Type": "application/json"},
        )

    # New snippet carrying version 5 keeps it.
    imp([{"abbreviation": "vv", "title": "", "body": "a", "version": 5}])
    s = next(x for x in client.get("/api/snippets").json() if x["abbreviation"] == "vv")
    assert s["version"] == 5

    # Identical content, lower incoming -> local wins (no downgrade).
    imp([{"abbreviation": "vv", "title": "", "body": "a", "version": 2}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 5

    # Identical content, higher incoming -> adopt.
    imp([{"abbreviation": "vv", "title": "", "body": "a", "version": 9}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 9

    # Content differs, incoming lower -> local+1 wins.
    imp([{"abbreviation": "vv", "title": "", "body": "b", "version": 3}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 10

    # Content differs, incoming higher -> incoming wins.
    imp([{"abbreviation": "vv", "title": "", "body": "c", "version": 42}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 42

    # Legacy file without version field: differs -> local+1; identical -> keep.
    imp([{"abbreviation": "vv", "title": "", "body": "d"}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 43
    imp([{"abbreviation": "vv", "title": "", "body": "d"}])
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 43


def test_version_survives_export_import_roundtrip(client):
    csrf = _auth(client)
    hdr = _hdr(csrf)
    s = _mk(client, hdr, "rt", body="one")
    client.patch(f"/api/snippets/{s['id']}", json={"body": "two"}, headers=hdr)
    client.patch(f"/api/snippets/{s['id']}", json={"body": "three"}, headers=hdr)  # v3

    exported = client.get("/api/snippets/export").json()
    row = next(x for x in exported["snippets"] if x["abbreviation"] == "rt")
    assert row["version"] == 3  # additive field in the envelope

    # Re-import of our own export is a no-op (identical content, same version).
    client.post(
        "/api/snippets/import",
        content=json.dumps(exported),
        headers={**hdr, "Content-Type": "application/json"},
    )
    assert client.get(f"/api/snippets/{s['id']}").json()["version"] == 3
