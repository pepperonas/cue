"""Substring search: LIKE wildcards in a user's term must match literally.

Regression: `?q=%` returned every row and `snake_case` matched `snakeXcase`,
because the term went into `%{q}%` unescaped.
"""
from __future__ import annotations

from conftest import auth as _auth

from app.search import contains_pattern, escape_like


def _mk(client, headers, body, **extra):
    res = client.post("/api/prompts", json={"body": body, **extra}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ------------------------------------------------------------------ unit level


def test_escape_like_neutralizes_wildcards():
    assert escape_like("100%") == "100\\%"
    assert escape_like("snake_case") == "snake\\_case"
    assert escape_like("a%b_c") == "a\\%b\\_c"


def test_escape_like_escapes_the_escape_character_first():
    # Otherwise the backslashes added for % / _ would be escaped a second time.
    assert escape_like("a\\b") == "a\\\\b"
    assert escape_like("\\%") == "\\\\\\%"


def test_escape_like_leaves_ordinary_terms_untouched():
    assert escape_like("feature") == "feature"
    assert contains_pattern("feature") == "%feature%"


# ------------------------------------------------------------ prompts endpoint


def test_percent_no_longer_matches_every_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "Ganz normaler Prompt")
    _mk(client, headers, "Auslastung bei 100% angekommen")

    hits = client.get("/api/prompts", headers=headers, params={"q": "%"}).json()
    assert [h["body"] for h in hits] == ["Auslastung bei 100% angekommen"]


def test_underscore_matches_literally_not_any_character(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "snake_case im Body")
    _mk(client, headers, "snakeXcase im Body")

    hits = client.get("/api/prompts", headers=headers, params={"q": "snake_case"}).json()
    assert [h["body"] for h in hits] == ["snake_case im Body"]


def test_plain_substring_search_still_works(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "Etwas über Migrationen")
    _mk(client, headers, "Etwas ganz anderes")

    hits = client.get("/api/prompts", headers=headers, params={"q": "Migration"}).json()
    assert len(hits) == 1


# --------------------------------------------------------------- tags endpoint


def test_tag_search_treats_wildcards_literally(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    for name in ("feature", "bug", "wip_2026"):
        assert client.post("/api/tags", json={"name": name}, headers=headers).status_code == 201

    everything = client.get("/api/tags", headers=headers, params={"q": "%"}).json()
    assert everything["total"] == 0  # no tag actually contains a percent sign

    literal = client.get("/api/tags", headers=headers, params={"q": "wip_2026"}).json()
    assert [t["name"] for t in literal["items"]] == ["wip_2026"]

    plain = client.get("/api/tags", headers=headers, params={"q": "fea"}).json()
    assert [t["name"] for t in plain["items"]] == ["feature"]
