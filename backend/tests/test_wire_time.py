"""Every timestamp that leaves the API carries its time zone.

A JSON date-time without a zone designator is LOCAL time to every browser
(ES2015+). SQLite hands rows back naive while a freshly written row is still
aware, so one and the same response used to carry both `...839915` and
`...997876Z` — the naive half arriving shifted by the viewer's UTC offset, two
hours in Berlin. Nothing computed with those values, so nothing was visibly
wrong; the relative ages on the cards do compute with them, and would have
reported everything younger than two hours as "gerade eben" forever.
"""
from __future__ import annotations

import inspect
import re
import typing
from datetime import datetime

import pytest
from conftest import auth

from app import schemas

# A serialized timestamp must end in Z or ±HH:MM.
ZONED = re.compile(r"\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$")


def _schema_models():
    for name, obj in vars(schemas).items():
        if inspect.isclass(obj) and issubclass(obj, schemas.BaseModel) and obj is not schemas.BaseModel:
            yield name, obj


def _timestamp_fields():
    """Every datetime a schema declares, with the metadata attached to it.

    Has to walk into `X | None` AND unwrap `Annotated`, because that is exactly
    where a bare `datetime` hides: an optional timestamp is the easy one to get
    wrong, and a check that only looks at the top level would report it clean.
    """
    for name, model in _schema_models():
        for field, info in model.model_fields.items():
            for member in typing.get_args(info.annotation) or (info.annotation,):
                if member is type(None):
                    continue
                base = typing.get_origin(member) is not None and typing.get_args(member) or ()
                leaf = base[0] if typing.get_origin(member) is typing.Annotated else member
                if leaf is datetime:
                    annotated = typing.get_origin(member) is typing.Annotated
                    yield f"{name}.{field}", bool(info.metadata) or annotated


def test_no_schema_declares_a_bare_datetime():
    """The structural half: a NEW schema cannot reintroduce the ambiguity.

    Checked over the whole module rather than over the fields this feature
    happens to read — the next timestamp someone adds is exactly the one that
    would slip through a hand-written list.
    """
    offenders = [name for name, normalized in _timestamp_fields() if not normalized]
    assert offenders == [], (
        "diese Felder liefern eine Zeit ohne Zone aus — `Utc` statt `datetime` verwenden: "
        + ", ".join(offenders)
    )


def test_the_sweep_actually_looks_at_something():
    """Guards the sweep above against passing because it found nothing."""
    checked = [name for name, _ in _timestamp_fields()]
    assert len(checked) >= 25, checked
    # Both shapes must be reached, or the optional ones are silently unchecked.
    assert "PromptRead.created_at" in checked
    assert "PromptRead.ran_at" in checked


def test_naive_input_is_labelled_utc_not_local():
    naive = datetime(2026, 8, 23, 12, 0, 0)
    read = schemas.PromptRead(
        id=1, title="t", body="b", project_id=None, status="queued", sort_order=1,
        tags="", bookmarked=False, bookmark_order=0, tested=False, blocked=False,
        created_at=naive, updated_at=naive, edited_at=naive, ran_at=None,
    )
    dumped = read.model_dump(mode="json")
    for field in ("created_at", "updated_at", "edited_at"):
        assert ZONED.search(dumped[field]), f"{field} = {dumped[field]}"
        assert dumped[field].startswith("2026-08-23T12:00:00"), "die Uhrzeit darf sich nicht verschieben"


def test_an_aware_timestamp_is_converted_not_relabelled():
    from datetime import timedelta, timezone

    berlin = datetime(2026, 8, 23, 14, 0, tzinfo=timezone(timedelta(hours=2)))
    read = schemas.PromptRead(
        id=1, title="t", body="b", project_id=None, status="queued", sort_order=1,
        tags="", bookmarked=False, bookmark_order=0, tested=False, blocked=False,
        created_at=berlin, updated_at=berlin, ran_at=None,
    )
    assert read.created_at.hour == 12, "14:00+02:00 ist 12:00 UTC"


@pytest.mark.parametrize("path", ["/api/prompts", "/api/projects", "/api/tags"])
def test_live_responses_carry_the_zone(client, path):
    """The end-to-end half: the values a browser really receives."""
    csrf = auth(client)
    client.post("/api/projects", json={"name": "P"}, headers={"X-CSRF-Token": csrf})
    client.post("/api/prompts", json={"body": "hallo", "tags": "x"}, headers={"X-CSRF-Token": csrf})

    payload = client.get(path).json()

    # Walks the whole document: the responses are variously a bare list, a
    # {items, total} envelope, and rows carrying nested lists of their own.
    seen = 0

    def scan(node, trail: str) -> None:
        nonlocal seen
        if isinstance(node, dict):
            for key, value in node.items():
                scan(value, f"{trail}.{key}")
        elif isinstance(node, list):
            for item in node:
                scan(item, trail)
        elif isinstance(node, str) and trail.endswith("_at"):
            assert ZONED.search(node), f"{path} {trail} = {node}"
            seen += 1

    scan(payload, path)
    assert seen >= 1, f"{path} lieferte keine Zeitstempel zum Prüfen"
