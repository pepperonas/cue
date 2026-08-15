"""What changed for a tenant — the basis of cross-device live updates.

Two browsers on two devices used to be two independent islands: a prompt
created on the phone stayed invisible on the desktop until someone hit reload.
This module answers the one question that fixes it — *has anything I care about
changed since cursor X?* — cheaply enough to be asked every second by
`routers/changes.py`'s long poll.

**A fingerprint, not a change counter.** The obvious alternative is a per-user
revision integer bumped on every write. It is O(1) to read, and it drifts the
moment someone adds a write path and forgets the bump — silently, in the
direction of "your other device just stops updating". A fingerprint is DERIVED
from the data, so there is no writer to forget: a row that changes changes the
fingerprint, whatever code changed it. The same reasoning the codebase already
applies to `Prompt.tags` and to stored-vs-displayed ordering, one level up.

**Per entity, not one global number**, so a snippet edit doesn't make three
other views refetch.

Two shapes, picked per table:

* `(count, max id, max updated_at)` for anything carrying a mutation
  timestamp. Three indexed aggregates, no row scan. It catches creation (count
  and max id), every edit and every move (`updated_at`), and deletion (count).
* a digest over the mutable columns for the two small tables that have no such
  timestamp (projects, snippet groups). Scanning a handful of rows costs
  nothing, and unlike a timestamp column nobody has to remember to touch it.
"""
from __future__ import annotations

import hashlib

from sqlmodel import Session, func, select

from .models import (
    CaptureSession,
    CapturedPrompt,
    Project,
    Prompt,
    Snippet,
    SnippetGroup,
    Tag,
)

# Entity keys are part of the wire format: the client maps them to the query
# keys it has to invalidate. Renaming one silently stops those updates.
PROMPTS = "prompts"
PROJECTS = "projects"
TAGS = "tags"
SNIPPETS = "snippets"
SESSIONS = "sessions"

ENTITIES = (PROMPTS, PROJECTS, TAGS, SNIPPETS, SESSIONS)

# Cursor framing. `_PART_SEP` must not occur inside a part — none of the shapes
# below can produce it. `_FIELD_SEP` may (a timestamp has colons), which is why
# `decode` splits on the FIRST one only.
_FIELD_SEP = ":"
_PART_SEP = "|"


def _stamped(session: Session, model, user_id: int) -> str:
    """`count.max_id.max_updated_at` for a table with a mutation timestamp."""
    row = session.exec(
        select(func.count(model.id), func.max(model.id), func.max(model.updated_at)).where(
            model.user_id == user_id
        )
    ).one()
    count, max_id, touched = row
    return f"{count or 0}.{max_id or 0}.{touched or ''}"


def _digest(rows: list[tuple]) -> str:
    """Short hash over the mutable state of a small table.

    Used where there is no `updated_at` to watch. Sorted before hashing so the
    result depends on the rows, not on the order the database returned them.
    """
    material = _PART_SEP.join(_FIELD_SEP.join(map(str, r)) for r in sorted(rows))
    return hashlib.blake2b(material.encode(), digest_size=8).hexdigest()


def _projects(session: Session, user_id: int) -> str:
    rows = session.exec(
        select(Project.id, Project.name, Project.color, Project.sort_order).where(
            Project.user_id == user_id
        )
    ).all()
    return _digest([tuple(r) for r in rows])


def _snippet_groups(session: Session, user_id: int) -> str:
    rows = session.exec(
        select(
            SnippetGroup.id, SnippetGroup.name, SnippetGroup.sort_order, SnippetGroup.synced
        ).where(SnippetGroup.user_id == user_id)
    ).all()
    return _digest([tuple(r) for r in rows])


def _sessions(session: Session, user_id: int) -> str:
    """Capture history: the sessions themselves plus the prompts inside them.

    `CapturedPrompt` has only `created_at` — it is append-only, so a count and
    the newest id say everything that can happen to it.
    """
    sess = session.exec(
        select(func.count(CaptureSession.id), func.max(CaptureSession.last_at)).where(
            CaptureSession.user_id == user_id
        )
    ).one()
    captured = session.exec(
        select(func.count(CapturedPrompt.id), func.max(CapturedPrompt.id)).where(
            CapturedPrompt.user_id == user_id
        )
    ).one()
    return f"{sess[0] or 0}.{sess[1] or ''}.{captured[0] or 0}.{captured[1] or 0}"


def fingerprint(session: Session, user_id: int) -> dict[str, str]:
    """One opaque marker per entity for this tenant."""
    return {
        PROMPTS: _stamped(session, Prompt, user_id),
        PROJECTS: _projects(session, user_id),
        TAGS: _stamped(session, Tag, user_id),
        # One marker for both tables: the Snippets view reloads them together,
        # and a value containing _PART_SEP would corrupt the cursor.
        SNIPPETS: _stamped(session, Snippet, user_id) + "." + _snippet_groups(session, user_id),
        SESSIONS: _sessions(session, user_id),
    }


def cursor_for(session: Session, user_id: int) -> str:
    """This tenant's whole fingerprint as one opaque string.

    Convenience for callers that only want "has anything changed" as a value
    they can compare or cache under — `app/stats.py` keys its cache on it, so
    the dashboard cannot outlive the data it was built from.
    """
    return encode(fingerprint(session, user_id))


def encode(parts: dict[str, str]) -> str:
    """Serialize a fingerprint into the opaque cursor the client echoes back."""
    return _PART_SEP.join(f"{key}{_FIELD_SEP}{parts[key]}" for key in ENTITIES if key in parts)


def decode(cursor: str | None) -> dict[str, str]:
    """Parse a cursor. Anything unparseable decodes to `{}` — an unknown cursor
    must read as "everything may have changed", never as an error: a client on
    an older build would otherwise be stuck instead of merely refetching once."""
    out: dict[str, str] = {}
    if not cursor:
        return out
    for chunk in cursor.split(_PART_SEP):
        key, sep, value = chunk.partition(_FIELD_SEP)
        if sep and key in ENTITIES:
            out[key] = value
    return out


def changed(before: dict[str, str], now: dict[str, str]) -> list[str]:
    """Entities whose marker moved, in a stable order.

    An entity missing from `before` counts as changed — see `decode`.
    """
    return [key for key in ENTITIES if key in now and before.get(key) != now[key]]
