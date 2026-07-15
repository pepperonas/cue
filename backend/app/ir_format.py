"""Inspector-Rust (IR) backup format: pure parse/build helpers.

No DB, no FastAPI — plain functions over plain data, so the format contract is
directly testable. cue reads IR backups tolerantly and writes exactly the
snippets-only envelope IR's "Settings → Backup & restore → Import" expects.

Write-side invariants (IR reads precisely this):
- version MUST be 2 (3 = with timesheet; IR rejects > 3).
- exported_at / created_at / updated_at are unix MILLIS.
- `abbreviation` is IR's merge key (UNIQUE there) — pass through verbatim
  (trim only).
- Groups travel by NAME via `category`; `snippet_categories` additionally
  carries EMPTY groups and their order.
- The category assignment is three-valued (IR >= v0.84.262):
    "<name>" -> put the snippet into that group (created if new)
    ""       -> explicitly ungrouped
    null     -> leave IR's existing assignment untouched (read-side legacy
                tolerance only — cue always WRITES "" for ungrouped).
- history/notes/totp_entries/settings stay empty so IR leaves them alone.
- `version` per snippet is an ADDITIVE field shared with IR's snippet
  versioning: written always, read tolerantly (missing/0 -> 1). Merge rule on
  BOTH sides: content differs -> max(incoming, local + 1); content identical
  -> max(incoming, local).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


class IRFormatError(ValueError):
    """Raised when an uploaded file cannot be used as an IR snippet backup."""


@dataclass
class ParsedSnippet:
    abbreviation: str
    title: str
    body: str
    # Three-valued: group name, "" (explicitly ungrouped), or None (untouched).
    category: str | None
    created_at_ms: int | None = None
    updated_at_ms: int | None = None
    # Content revision (additive field, shared with IR >= versioning support).
    # None = the source file predates the field -> treated as 1 when merging.
    version: int | None = None


@dataclass
class ParsedSnippets:
    snippets: list[ParsedSnippet] = field(default_factory=list)
    # (name, sort_order) — includes empty groups from snippet_categories.
    categories: list[tuple[str, int]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    skipped: int = 0


def _ms(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _parse_items(items, out: ParsedSnippets, categories_known: bool) -> None:
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            out.errors.append(f"Eintrag {idx + 1}: kein Objekt — übersprungen")
            out.skipped += 1
            continue
        abbreviation = str(item.get("abbreviation") or "").strip()
        body = item.get("body")
        body = body if isinstance(body, str) else ""
        if not abbreviation:
            out.errors.append(f"Eintrag {idx + 1}: leere Abkürzung — übersprungen")
            out.skipped += 1
            continue
        if not body.strip():
            out.errors.append(f'„{abbreviation}": leerer Body — übersprungen')
            out.skipped += 1
            continue
        if categories_known:
            raw_cat = item.get("category", None)
            if raw_cat is None:
                category: str | None = None
            elif isinstance(raw_cat, str):
                category = raw_cat.strip()
            else:
                category = None
        else:
            # Legacy format knows no categories -> everything lands ungrouped.
            category = ""
        try:
            raw_version = int(item.get("version") or 0)
        except (TypeError, ValueError):
            raw_version = 0
        out.snippets.append(
            ParsedSnippet(
                abbreviation=abbreviation,
                title=str(item.get("title") or ""),
                body=body,
                category=category,
                created_at_ms=_ms(item.get("created_at")),
                updated_at_ms=_ms(item.get("updated_at")),
                version=raw_version if raw_version > 0 else None,
            )
        )


def parse_ir_backup(raw: str) -> ParsedSnippets:
    """Read an IR backup (full envelope, snippets-only, or legacy list).

    Tolerant on the read side; raises IRFormatError only for unusable inputs
    (invalid JSON, encrypted backups, no snippet data at all)."""
    try:
        doc = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise IRFormatError(f"Kein gültiges JSON: {exc}") from exc

    out = ParsedSnippets()

    # Legacy fallback: a bare list of {abbreviation, title?, body}.
    if isinstance(doc, list):
        _parse_items(doc, out, categories_known=False)
        return out

    if not isinstance(doc, dict):
        raise IRFormatError("Unbekanntes Format: weder Objekt noch Liste")

    if doc.get("encrypted") is True:
        raise IRFormatError(
            "Das Backup ist verschlüsselt. Bitte in Inspector Rust unverschlüsselt "
            "exportieren (Settings → Backup & restore)."
        )

    if "snippets" not in doc:
        raise IRFormatError("Keine Snippets im Backup gefunden")
    items = doc.get("snippets")
    if not isinstance(items, list):
        raise IRFormatError('„snippets" ist keine Liste')

    # Envelope vs. legacy {"snippets": [...]}: the presence of version or
    # snippet_categories marks the real backup format (category-aware).
    categories_known = "version" in doc or "snippet_categories" in doc

    raw_cats = doc.get("snippet_categories")
    if isinstance(raw_cats, list):
        for idx, cat in enumerate(raw_cats):
            if isinstance(cat, dict) and str(cat.get("name") or "").strip():
                name = str(cat["name"]).strip()
                try:
                    order = int(cat.get("sort_order") or (idx + 1))
                except (TypeError, ValueError):
                    order = idx + 1
                out.categories.append((name, order))

    _parse_items(items, out, categories_known=categories_known)
    return out


def build_ir_backup(snippets, groups, now_ms: int) -> dict:
    """Build the snippets-only IR backup envelope.

    `snippets`: iterables with .abbreviation/.title/.body/.group_name and
    .created_at_ms/.updated_at_ms (or dicts with those keys).
    `groups`: ordered group names (empty groups included)."""

    def _get(obj, key):
        return obj.get(key) if isinstance(obj, dict) else getattr(obj, key)

    return {
        "version": 2,
        "exported_at": now_ms,
        "snippet_categories": [
            {"name": name, "sort_order": idx + 1} for idx, name in enumerate(groups)
        ],
        "snippets": [
            {
                "id": idx + 1,
                "abbreviation": _get(s, "abbreviation"),
                "title": _get(s, "title") or "",
                "body": _get(s, "body"),
                "created_at": _get(s, "created_at_ms") or now_ms,
                "updated_at": _get(s, "updated_at_ms") or now_ms,
                # Additive field (IR ignores unknown keys pre-versioning; with
                # versioning both sides converge via the shared max() merge).
                "version": _get(s, "version") or 1,
                # cue always writes "" for ungrouped (never null): "" is IR's
                # explicit "ungroup", null would leave IR's assignment as-is.
                "category": _get(s, "group_name") or "",
            }
            for idx, s in enumerate(snippets)
        ],
        "history": [],
        "notes": [],
        "totp_entries": [],
        "settings": {},
    }
