"""Pure parser/builder tests for the Inspector-Rust backup format contract."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ir_format import IRFormatError, build_ir_backup, parse_ir_backup

FIXTURE = Path(__file__).parent / "fixtures" / "ir-backup-snippets.json"


def test_full_envelope_parses_snippets_and_categories():
    parsed = parse_ir_backup(FIXTURE.read_text())
    assert len(parsed.snippets) == 28
    assert parsed.errors == [] and parsed.skipped == 0
    names = [name for name, _ in parsed.categories]
    assert names == ["AI Prompts", "Scratch"]  # incl. the deliberately EMPTY group
    by_abbr = {s.abbreviation: s for s in parsed.snippets}
    assert by_abbr["aiplan"].category == "AI Prompts"
    assert by_abbr["loose"].category is None  # legacy null -> "leave untouched"
    assert by_abbr["aiplan"].created_at_ms == 1752300000000  # unix millis


def test_snippets_only_backup_parses():
    doc = {
        "version": 2,
        "snippets": [
            {"abbreviation": "x", "title": "T", "body": "B", "category": "G"},
            {"abbreviation": "y", "body": "B2", "category": ""},
        ],
    }
    parsed = parse_ir_backup(json.dumps(doc))
    assert [s.abbreviation for s in parsed.snippets] == ["x", "y"]
    assert parsed.snippets[0].category == "G"
    assert parsed.snippets[1].category == ""  # explicit ungroup preserved


def test_legacy_array_has_no_category_concept():
    parsed = parse_ir_backup(json.dumps([{"abbreviation": "a", "body": "b"}]))
    assert parsed.snippets[0].category == ""  # everything lands ungrouped
    assert parsed.categories == []


def test_legacy_snippets_object_without_version_is_category_blind():
    parsed = parse_ir_backup(json.dumps({"snippets": [{"abbreviation": "a", "body": "b"}]}))
    assert parsed.snippets[0].category == ""


def test_encrypted_backup_is_rejected_with_clear_message():
    doc = {"encrypted": True, "kdf": "argon2id", "payload": "…"}
    with pytest.raises(IRFormatError) as exc:
        parse_ir_backup(json.dumps(doc))
    assert "unverschlüsselt" in str(exc.value)


def test_broken_json_and_wrong_shapes():
    with pytest.raises(IRFormatError):
        parse_ir_backup("{not json")
    with pytest.raises(IRFormatError):
        parse_ir_backup(json.dumps("just a string"))
    with pytest.raises(IRFormatError):
        parse_ir_backup(json.dumps({"notes": []}))  # no snippet data at all
    with pytest.raises(IRFormatError):
        parse_ir_backup(json.dumps({"snippets": "nope"}))


def test_rows_with_missing_fields_are_skipped_not_fatal():
    doc = {
        "version": 2,
        "snippets": [
            {"abbreviation": "", "body": "b"},
            {"abbreviation": "ok", "body": "   "},
            "not-an-object",
            {"abbreviation": "fine", "body": "works"},
        ],
    }
    parsed = parse_ir_backup(json.dumps(doc))
    assert [s.abbreviation for s in parsed.snippets] == ["fine"]
    assert parsed.skipped == 3 and len(parsed.errors) == 3


def test_unicode_bodies_roundtrip_verbatim():
    body = 'Grüße 👋 — é́ „Zitat"\n\ttabs & <html>'
    doc = build_ir_backup(
        [{"abbreviation": "u", "title": "Ümlaut", "body": body,
          "group_name": None, "created_at_ms": 1, "updated_at_ms": 2}],
        [],
        now_ms=1000,
    )
    parsed = parse_ir_backup(json.dumps(doc, ensure_ascii=False))
    assert parsed.snippets[0].body == body
    assert parsed.snippets[0].title == "Ümlaut"


def test_build_envelope_invariants():
    doc = build_ir_backup(
        [
            {"abbreviation": "a", "title": "", "body": "b", "group_name": "G",
             "created_at_ms": 1752300000000, "updated_at_ms": 1752300000001},
            {"abbreviation": "free", "title": "t", "body": "b2", "group_name": None,
             "created_at_ms": None, "updated_at_ms": None},
        ],
        ["G", "Empty"],
        now_ms=1752399999999,
    )
    assert doc["version"] == 2  # 3 = timesheet; >3 is rejected by IR
    assert doc["exported_at"] == 1752399999999  # millis, not seconds
    assert doc["history"] == [] and doc["notes"] == []
    assert doc["totp_entries"] == [] and doc["settings"] == {}
    assert doc["snippet_categories"] == [
        {"name": "G", "sort_order": 1},
        {"name": "Empty", "sort_order": 2},  # empty group travels
    ]
    a, free = doc["snippets"]
    assert a["category"] == "G"
    assert free["category"] == ""  # ungrouped exports as "" — NEVER null
    assert a["created_at"] == 1752300000000 and a["updated_at"] == 1752300000001
    assert free["created_at"] == 1752399999999  # fallback: now


def test_pure_roundtrip_is_lossless():
    parsed = parse_ir_backup(FIXTURE.read_text())
    doc = build_ir_backup(
        [
            {
                "abbreviation": s.abbreviation,
                "title": s.title,
                "body": s.body,
                # null on the read side means "leave IR untouched" — inside cue
                # that materializes as ungrouped, which exports as "".
                "group_name": s.category or None,
                "created_at_ms": s.created_at_ms,
                "updated_at_ms": s.updated_at_ms,
            }
            for s in parsed.snippets
        ],
        [name for name, _ in parsed.categories],
        now_ms=1,
    )
    reparsed = parse_ir_backup(json.dumps(doc, ensure_ascii=False))
    assert {s.abbreviation for s in reparsed.snippets} == {
        s.abbreviation for s in parsed.snippets
    }
    original_bodies = {s.abbreviation: s.body for s in parsed.snippets}
    for s in reparsed.snippets:
        assert s.body == original_bodies[s.abbreviation]  # char-exact
    assert [n for n, _ in reparsed.categories] == ["AI Prompts", "Scratch"]


# ═══════════════════════════════════════════════════════════════════════════
# Generated test-case pass (happy / edge / failure / state) for the version
# field and the remaining untested tolerance branches.
# ═══════════════════════════════════════════════════════════════════════════

# ---- Happy path ----
def test_version_field_parses_into_snippet():
    doc = {"version": 2, "snippets": [{"abbreviation": "v", "body": "b", "version": 7}]}
    parsed = parse_ir_backup(json.dumps(doc))
    assert parsed.snippets[0].version == 7


def test_build_writes_version_verbatim_and_defaults_to_one():
    doc = build_ir_backup(
        [
            {"abbreviation": "a", "title": "", "body": "b", "group_name": None,
             "created_at_ms": 1, "updated_at_ms": 1, "version": 12},
            {"abbreviation": "b", "title": "", "body": "b", "group_name": None,
             "created_at_ms": 1, "updated_at_ms": 1, "version": None},
        ],
        [],
        now_ms=5,
    )
    assert doc["snippets"][0]["version"] == 12
    assert doc["snippets"][1]["version"] == 1  # absent -> 1, never null


# ---- Edge cases ----
def test_version_boundary_and_exotic_values_normalize_to_none_or_int():
    rows = [
        {"abbreviation": "s0", "body": "b", "version": 0},      # 0 -> None (treated as 1 later)
        {"abbreviation": "s-1", "body": "b", "version": -1},    # negative -> None
        {"abbreviation": "sstr", "body": "b", "version": "3"},  # numeric string -> 3
        {"abbreviation": "sbad", "body": "b", "version": "x"},  # junk string -> None
        {"abbreviation": "slist", "body": "b", "version": [2]}, # wrong type -> None
        {"abbreviation": "smiss", "body": "b"},                 # missing -> None
    ]
    parsed = parse_ir_backup(json.dumps({"version": 2, "snippets": rows}))
    by = {s.abbreviation: s.version for s in parsed.snippets}
    assert by == {"s0": None, "s-1": None, "sstr": 3, "sbad": None, "slist": None, "smiss": None}
    assert parsed.errors == []  # tolerance, never a hard failure


def test_non_string_category_is_treated_as_untouched():
    doc = {"version": 2, "snippets": [{"abbreviation": "c", "body": "b", "category": 42}]}
    parsed = parse_ir_backup(json.dumps(doc))
    assert parsed.snippets[0].category is None  # like null: leave IR's assignment alone


def test_category_sort_order_garbage_falls_back_to_position():
    doc = {
        "version": 2,
        "snippets": [],
        "snippet_categories": [
            {"name": "A", "sort_order": "not-a-number"},
            {"name": "B"},  # missing
            {"name": "C", "sort_order": 99},
        ],
    }
    parsed = parse_ir_backup(json.dumps(doc))
    assert parsed.categories == [("A", 1), ("B", 2), ("C", 99)]


def test_duplicate_abbreviations_within_one_file_are_both_surfaced():
    """Dedup is the DB layer's job (upsert per abbreviation); the parser must
    not silently drop rows — last-write-wins happens at import time."""
    doc = {"version": 2, "snippets": [
        {"abbreviation": "dup", "body": "first"},
        {"abbreviation": "dup", "body": "second"},
    ]}
    parsed = parse_ir_backup(json.dumps(doc))
    assert [s.body for s in parsed.snippets] == ["first", "second"]


def test_megabyte_body_survives_parse_build_char_exact():
    body = ("ä✓" + "x" * 62) * 16384  # ~1 MiB of mixed unicode
    doc = build_ir_backup(
        [{"abbreviation": "big", "title": "", "body": body, "group_name": None,
          "created_at_ms": 1, "updated_at_ms": 1, "version": 1}],
        [],
        now_ms=1,
    )
    reparsed = parse_ir_backup(json.dumps(doc, ensure_ascii=False))
    assert reparsed.snippets[0].body == body


def test_empty_snippet_list_is_a_valid_backup():
    parsed = parse_ir_backup(json.dumps({"version": 2, "snippets": []}))
    assert parsed.snippets == [] and parsed.categories == []
    assert parsed.errors == [] and parsed.skipped == 0


# ---- Failure modes ----
def test_encrypted_false_is_not_rejected():
    doc = {"version": 2, "encrypted": False,
           "snippets": [{"abbreviation": "ok", "body": "b"}]}
    parsed = parse_ir_backup(json.dumps(doc))  # only encrypted: true rejects
    assert len(parsed.snippets) == 1


def test_all_rows_invalid_yields_errors_not_exception():
    doc = {"version": 2, "snippets": [
        {"abbreviation": "", "body": "b"},
        {"abbreviation": "x", "body": ""},
        None,
    ]}
    parsed = parse_ir_backup(json.dumps(doc))
    assert parsed.snippets == []
    assert parsed.skipped == 3 and len(parsed.errors) == 3


# ---- State / purity ----
def test_parse_results_are_independent_between_calls():
    """The module is pure: two parses share no state; mutating one result
    must not leak into the other."""
    raw = json.dumps({"version": 2, "snippets": [{"abbreviation": "a", "body": "b"}]})
    first = parse_ir_backup(raw)
    second = parse_ir_backup(raw)
    first.snippets[0].body = "MUTATED"
    first.errors.append("MUTATED")
    assert second.snippets[0].body == "b"
    assert second.errors == []
