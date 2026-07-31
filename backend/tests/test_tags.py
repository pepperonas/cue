"""Central tag vocabulary: normalization, references, rename/merge, delete, migration."""
from __future__ import annotations

from conftest import auth as _auth

from app.tags import is_bug_priority, join_names, normalize, split_names


def _mk(client, headers, body="Ein Prompt", **extra):
    res = client.post("/api/prompts", json={"body": body, **extra}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _tags(client, headers, **params):
    res = client.get("/api/tags", headers=headers, params=params)
    assert res.status_code == 200, res.text
    return res.json()


def _by_name(client, headers, name):
    return next(t for t in _tags(client, headers)["items"] if t["name"].lower() == name.lower())


# --------------------------------------------------------------- normalization


def test_normalize_trims_collapses_and_drops_commas():
    assert normalize("  feature  ") == "feature"
    assert normalize("dark   mode") == "dark mode"
    assert normalize("a,b") == "a b"  # commas separate, they can't be inside a tag
    assert normalize("") == ""
    assert normalize("   ") == ""
    assert len(normalize("x" * 200)) == 40


def test_split_names_dedupes_case_insensitively_and_keeps_order():
    assert split_names("api, React , api, REACT, ui") == ["api", "React", "ui"]
    assert split_names("") == []
    assert split_names(None) == []
    assert split_names(" , , ") == []
    assert join_names(["a", "b"]) == "a, b"


def test_is_bug_priority_matches_the_bug_tag_cluster():
    assert is_bug_priority("bug")
    assert is_bug_priority("Bugfix")
    assert is_bug_priority("feature, bug-report")
    assert is_bug_priority("  BUG  ")
    assert is_bug_priority("bugs")  # starts with "bug"
    assert is_bug_priority("bug-triage, chore")
    assert not is_bug_priority("feature, hotfix")
    assert not is_bug_priority("fix")
    assert not is_bug_priority("regression")
    assert not is_bug_priority("")
    assert not is_bug_priority(None)
    assert not is_bug_priority("debug")  # prefix match on the tag token, not a substring
    assert not is_bug_priority("a-bug")  # must START with bug
    assert not is_bug_priority(" debugged ")


def test_bug_tagged_prompts_land_at_the_top_of_the_queue(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    first = _mk(client, headers, "normal A")
    second = _mk(client, headers, "normal B")
    bug = _mk(client, headers, "fix the crash", tags="bugfix")
    # Fresh bugfix sits above both earlier queued prompts.
    assert bug["sort_order"] < first["sort_order"]
    assert bug["sort_order"] < second["sort_order"]
    # A second bug lands above the first one (newest bug on top).
    another = _mk(client, headers, "another crash", tags="Bug")
    assert another["sort_order"] < bug["sort_order"]
    # Non-bug tags still append.
    plain = _mk(client, headers, "feature work", tags="feature")
    assert plain["sort_order"] > second["sort_order"]


def test_bug_priority_is_case_and_whitespace_tolerant_on_create(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    base = _mk(client, headers, "baseline")
    for tags in ("BUG", "  bugfix  ", "ui, BUG-REPORT", "BugFix"):
        created = _mk(client, headers, f"body for {tags}", tags=tags)
        assert created["sort_order"] < base["sort_order"], tags


def test_bug_tag_does_not_reorder_non_queued_creates(client):
    """Bug priority only applies to the queue — done/running keep append order."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    done_a = _mk(client, headers, "done A", status="done")
    done_bug = _mk(client, headers, "done bug", status="done", tags="bug")
    # Done still uses append (done-on-top is a separate status-transition rule).
    assert done_bug["sort_order"] > done_a["sort_order"]


def test_adding_a_bug_tag_later_does_not_auto_promote(client):
    """Priority is a create-time placement, not a permanent float-to-top rule."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    plain = _mk(client, headers, "plain")
    _mk(client, headers, "later")
    patched = client.patch(
        f"/api/prompts/{plain['id']}",
        json={"tags": "bug"},
        headers=headers,
    ).json()
    assert patched["tags"] == "bug"
    assert patched["sort_order"] == plain["sort_order"]


def test_bug_among_other_tags_still_promotes_on_create(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    earlier = _mk(client, headers, "earlier", tags="feature, urgent")
    mixed = _mk(client, headers, "mixed", tags="refactor, bugfix, ui")
    assert mixed["sort_order"] < earlier["sort_order"]


# ------------------------------------------------------------------- vocabulary


def test_tags_materialize_when_a_prompt_uses_them(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Body", tags=" Feature , ui ")

    # The cache string is normalized …
    assert prompt["tags"] == "Feature, ui"
    # … and the vocabulary now holds both, each used once.
    body = _tags(client, headers)
    assert body["total"] == 2
    assert {t["name"]: t["usage_count"] for t in body["items"]} == {"Feature": 1, "ui": 1}


def test_same_tag_in_different_spellings_is_one_entry(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "A", tags="Feature")
    _mk(client, headers, "B", tags="feature")
    _mk(client, headers, "C", tags="FEATURE")
    body = _tags(client, headers)
    assert body["total"] == 1
    assert body["items"][0]["usage_count"] == 3
    # The first spelling wins as the display name.
    assert body["items"][0]["name"] == "Feature"


def test_a_prompt_never_carries_the_same_tag_twice(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A", tags="api, API, api")
    assert prompt["tags"] == "api"
    assert _by_name(client, headers, "api")["usage_count"] == 1


def test_create_tag_without_using_it(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    res = client.post("/api/tags", json={"name": "  neue-idee "}, headers=headers)
    assert res.status_code == 201, res.text
    tag = res.json()
    assert tag["name"] == "neue-idee" and tag["usage_count"] == 0
    assert tag["source"] == "user"

    # Available for autocomplete immediately, and not creatable twice.
    assert any(t["name"] == "neue-idee" for t in _tags(client, headers)["items"])
    dup = client.post("/api/tags", json={"name": "Neue-Idee"}, headers=headers)
    assert dup.status_code == 409
    assert client.post("/api/tags", json={"name": "   "}, headers=headers).status_code == 400


def test_updating_a_prompt_rewrites_its_links(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A", tags="alt, bleibt")
    updated = client.patch(
        f"/api/prompts/{prompt['id']}", json={"tags": "bleibt, neu"}, headers=headers
    ).json()
    assert updated["tags"] == "bleibt, neu"
    counts = {t["name"]: t["usage_count"] for t in _tags(client, headers)["items"]}
    # "alt" stays in the vocabulary but is no longer used anywhere.
    assert counts == {"alt": 0, "bleibt": 1, "neu": 1}


def test_search_and_sorting(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "A", tags="frontend, backend")
    _mk(client, headers, "B", tags="frontend")

    found = _tags(client, headers, q="END")  # case-insensitive substring
    assert {t["name"] for t in found["items"]} == {"frontend", "backend"}
    assert _tags(client, headers, q="front")["total"] == 1
    assert _tags(client, headers, q="zzz")["items"] == []

    by_usage = [t["name"] for t in _tags(client, headers, sort="usage")["items"]]
    assert by_usage[0] == "frontend"  # 2 uses beats 1
    by_name = [t["name"] for t in _tags(client, headers, sort="name")["items"]]
    assert by_name == ["backend", "frontend"]


# ----------------------------------------------------------------------- rename


def test_rename_updates_every_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A", tags="typo, keep")
    b = _mk(client, headers, "B", tags="typo")
    tag = _by_name(client, headers, "typo")

    res = client.patch(f"/api/tags/{tag['id']}", json={"name": "korrekt"}, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["merged"] is False
    assert res.json()["tag"]["name"] == "korrekt"

    assert client.get(f"/api/prompts/{a['id']}", headers=headers).json()["tags"] == "korrekt, keep"
    assert client.get(f"/api/prompts/{b['id']}", headers=headers).json()["tags"] == "korrekt"
    assert {t["name"] for t in _tags(client, headers)["items"]} == {"korrekt", "keep"}


def test_rename_onto_an_existing_tag_merges_without_duplicates(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    both = _mk(client, headers, "A", tags="ui, frontend")  # already has the target
    only_old = _mk(client, headers, "B", tags="ui")
    ui = _by_name(client, headers, "ui")

    res = client.patch(f"/api/tags/{ui['id']}", json={"name": "frontend"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["merged"] is True

    # One vocabulary entry left, and no prompt lists it twice.
    names = {t["name"] for t in _tags(client, headers)["items"]}
    assert names == {"frontend"}
    assert client.get(f"/api/prompts/{both['id']}", headers=headers).json()["tags"] == "frontend"
    assert client.get(f"/api/prompts/{only_old['id']}", headers=headers).json()["tags"] == "frontend"
    assert _by_name(client, headers, "frontend")["usage_count"] == 2


def test_rename_can_fix_only_the_spelling(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A", tags="api")
    tag = _by_name(client, headers, "api")
    res = client.patch(f"/api/tags/{tag['id']}", json={"name": "API"}, headers=headers)
    assert res.status_code == 200 and res.json()["merged"] is False
    assert client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()["tags"] == "API"


def test_rename_validation(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "A", tags="x")
    tag = _by_name(client, headers, "x")
    assert client.patch(f"/api/tags/{tag['id']}", json={"name": " "}, headers=headers).status_code == 400
    assert client.patch("/api/tags/9999", json={"name": "y"}, headers=headers).status_code == 404


# ----------------------------------------------------------------------- delete


def test_usage_endpoint_lists_the_affected_prompts(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A", tags="doomed")
    b = _mk(client, headers, "B", tags="doomed")
    _mk(client, headers, "C", tags="other")
    tag = _by_name(client, headers, "doomed")

    usage = client.get(f"/api/tags/{tag['id']}/usage", headers=headers).json()
    assert usage["tag"]["usage_count"] == 2
    assert {p["id"] for p in usage["prompts"]} == {a["id"], b["id"]}
    assert all(p["title"] for p in usage["prompts"])


def test_delete_removes_the_tag_from_every_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A", tags="weg, bleibt")
    tag = _by_name(client, headers, "weg")

    res = client.delete(f"/api/tags/{tag['id']}", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json() == {"deleted": 1, "prompts_updated": 1, "replaced_with": None}

    assert client.get(f"/api/prompts/{a['id']}", headers=headers).json()["tags"] == "bleibt"
    assert {t["name"] for t in _tags(client, headers)["items"]} == {"bleibt"}


def test_delete_with_replacement_repoints_the_assignments(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A", tags="alt")
    b = _mk(client, headers, "B", tags="alt, neu")  # already carries the replacement
    old = _by_name(client, headers, "alt")
    new = _by_name(client, headers, "neu")

    res = client.delete(f"/api/tags/{old['id']}?replace_with={new['id']}", headers=headers)
    assert res.status_code == 200 and res.json()["prompts_updated"] == 2

    assert client.get(f"/api/prompts/{a['id']}", headers=headers).json()["tags"] == "neu"
    # No duplicate on the prompt that already had the target.
    assert client.get(f"/api/prompts/{b['id']}", headers=headers).json()["tags"] == "neu"
    assert _by_name(client, headers, "neu")["usage_count"] == 2


def test_delete_validation(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "A", tags="x")
    tag = _by_name(client, headers, "x")
    assert client.delete("/api/tags/9999", headers=headers).status_code == 404
    assert (
        client.delete(f"/api/tags/{tag['id']}?replace_with=9999", headers=headers).status_code == 404
    )
    assert (
        client.delete(f"/api/tags/{tag['id']}?replace_with={tag['id']}", headers=headers).status_code
        == 400
    )


# ------------------------------------------------------- consistency & tenancy


def test_deleting_a_prompt_drops_its_links_but_keeps_the_vocabulary(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A", tags="bleibt-im-vokabular")
    assert client.delete(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 204
    tag = _by_name(client, headers, "bleibt-im-vokabular")
    assert tag["usage_count"] == 0


def test_duplicate_and_merge_carry_the_links_over(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A", tags="shared")
    copy = client.post(
        f"/api/prompts/{a['id']}/duplicate", json={"in_place": True}, headers=headers
    ).json()
    assert copy["tags"] == "shared"
    assert _by_name(client, headers, "shared")["usage_count"] == 2

    b = _mk(client, headers, "B", tags="other")
    merged = client.post(
        "/api/prompts/merge",
        json={
            "source_ids": [a["id"], b["id"]],
            "title": "M",
            "body": "A\n\nB",
            "tags": "shared, other",
            "originals": "delete",
        },
        headers=headers,
    ).json()
    assert merged["tags"] == "shared, other"
    counts = {t["name"]: t["usage_count"] for t in _tags(client, headers)["items"]}
    assert counts["shared"] == 2  # the merged prompt + the duplicate
    assert counts["other"] == 1


def test_tags_are_per_tenant(client):
    # `auth()` swaps the session cookie, so the id of tenant A's tag has to be
    # read while A is still the signed-in user.
    csrf_a = _auth(client, "owner@example.com")
    headers_a = {"X-CSRF-Token": csrf_a}
    _mk(client, headers_a, "A", tags="geheim")
    assert _tags(client, headers_a)["total"] == 1
    foreign_id = _by_name(client, headers_a, "geheim")["id"]

    csrf_b = _auth(client, "other@example.com", sub="sub-other")
    headers_b = {"X-CSRF-Token": csrf_b}
    assert _tags(client, headers_b)["total"] == 0
    # Same word, own entry — and no access to the other tenant's row.
    _mk(client, headers_b, "B", tags="geheim")
    assert _tags(client, headers_b)["total"] == 1
    assert _by_name(client, headers_b, "geheim")["id"] != foreign_id
    assert client.patch(f"/api/tags/{foreign_id}", json={"name": "x"}, headers=headers_b).status_code == 404
    assert client.delete(f"/api/tags/{foreign_id}", headers=headers_b).status_code == 404


def test_tag_endpoints_require_authentication(client):
    client.cookies.clear()
    assert client.get("/api/tags").status_code == 401


def test_cache_string_and_links_stay_in_sync(client):
    """The comma cache is derived state — this is its guard."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A", tags="eins, zwei, drei")

    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Prompt, PromptTag, Tag
    from app.tags import TagService

    with Session(db_module.engine) as s:
        row = s.get(Prompt, prompt["id"])
        links = s.exec(select(PromptTag).where(PromptTag.prompt_id == row.id)).all()
        names = [s.get(Tag, link.tag_id).name for link in sorted(links, key=lambda x: x.position)]
        assert row.tags == ", ".join(names) == "eins, zwei, drei"

        # Corrupt the cache and let the service repair it.
        row.tags = "kaputt"
        s.add(row)
        s.commit()
        TagService(s).rebuild_cache(row.user_id)
        s.refresh(row)
        assert row.tags == "eins, zwei, drei"


def test_legacy_comma_strings_are_migrated(client):
    """Prompts written before the vocabulary existed get links on startup."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "A")  # no tags

    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Prompt, PromptTag, Tag
    from app.tags import TagService

    with Session(db_module.engine) as s:
        row = s.get(Prompt, prompt["id"])
        row.tags = "Legacy, alt-tag"  # simulate a pre-migration row
        s.add(row)
        s.commit()
        uid = row.user_id

        assert TagService(s).backfill_from_strings(uid) == 1
        links = s.exec(select(PromptTag).where(PromptTag.prompt_id == row.id)).all()
        assert len(links) == 2
        names = {s.get(Tag, link.tag_id).name for link in links}
        assert names == {"Legacy", "alt-tag"}
        # Migrated tags are marked as system provenance …
        assert all(s.get(Tag, link.tag_id).source.value == "system" for link in links)
        # … and running it again changes nothing.
        assert TagService(s).backfill_from_strings(uid) == 0


def test_usage_of_an_unknown_tag_is_404(client):
    csrf = _auth(client)
    assert client.get("/api/tags/9999/usage", headers={"X-CSRF-Token": csrf}).status_code == 404


def test_sort_by_creation_and_recent_use(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    client.post("/api/tags", json={"name": "zuerst"}, headers=headers)
    client.post("/api/tags", json={"name": "danach"}, headers=headers)
    _mk(client, headers, "A", tags="benutzt")

    newest_first = [t["name"] for t in _tags(client, headers, sort="created")["items"]]
    assert newest_first[0] == "benutzt"  # created last
    recent = _tags(client, headers, sort="recent")["items"]
    # Only the used tag has a last_used_at, so it ranks first.
    assert recent[0]["name"] == "benutzt" and recent[0]["last_used_at"] is not None
    assert recent[-1]["last_used_at"] is None


def test_deleting_a_prompt_with_optimization_history_works(client):
    """Regression: the optimization FK blocked prompt deletion with a 500."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Wird optimiert und dann gelöscht", tags="x")
    created = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert created.status_code == 201, created.text

    assert client.delete(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 404
    # The history went with it.
    assert client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json() == []
