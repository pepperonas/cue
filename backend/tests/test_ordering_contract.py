"""The server half of the shared column-order contract.

`contracts/column-order.json` describes how one status column is ordered. This
suite runs every case through `app.ordering.display_key`;
`frontend/src/lib/order.contract.test.ts` runs the SAME cases through
`columnComparator`. Neither file owns the contract, so a change to one
implementation alone turns that side red instead of silently disagreeing with
the other.

Why this matters more than it looks: a drag sends an anchor ("put it before
#42"), never a position. The client picks the anchor from the order it SHOWS,
the server inserts into the order it STORES. When those two drifted apart, a
drag was saved and changed nothing on screen — production had a queued column
where "put it before #184" landed mid-list because blocked prompts were stored
inline but displayed at the bottom.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "column-order.json"


def _load() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def _row(spec: dict) -> SimpleNamespace:
    """A prompt stand-in carrying exactly the stored fields the key may read."""
    return SimpleNamespace(
        id=spec["id"],
        sort_order=spec["sort_order"],
        status=spec.get("status", "queued"),
        blocked=spec.get("blocked", False),
        tested=spec.get("tested", False),
        priority=spec.get("priority", "normal"),
        test_closely=spec.get("test_closely", False),
        ran_at=spec.get("ran_at"),
    )


def _case_ids() -> list[str]:
    return [case["name"] for case in _load()["cases"]]


@pytest.mark.parametrize("case", _load()["cases"], ids=_case_ids())
def test_display_key_matches_the_shared_contract(case):
    from app.ordering import display_key

    rows = [_row(spec) for spec in case["prompts"]]
    ordered = [row.id for row in sorted(rows, key=display_key)]
    assert ordered == case["expected_ids"], case["why"]


def test_the_contract_is_reversal_proof():
    """Sorting must not depend on the order the rows arrived in.

    The database returns a column in whatever order the query plan produces;
    two clients seeing different sequences for the same data would anchor their
    drags against different neighbours.
    """
    from app.ordering import display_key

    for case in _load()["cases"]:
        rows = [_row(spec) for spec in case["prompts"]]
        forwards = [r.id for r in sorted(rows, key=display_key)]
        backwards = [r.id for r in sorted(list(reversed(rows)), key=display_key)]
        assert forwards == backwards == case["expected_ids"], case["name"]


def test_the_key_reads_no_field_the_contract_does_not_declare():
    """Guards the rule that only stored, drag-controllable fields take part.

    `ran_at` is the concrete precedent: ordering the tested block by execution
    time made dragging inside it a guaranteed no-op. A stand-in that explodes
    on any unexpected attribute catches a new dependency the moment it appears
    — including one on `ran_at`, which the contract carries only to prove it is
    IGNORED.
    """
    from app.ordering import display_key

    allowed = {"id", "sort_order", "status", "blocked", "tested", "priority", "test_closely"}
    touched: set[str] = set()

    class Strict:
        def __init__(self, spec: dict) -> None:
            self._spec = spec

        def __getattr__(self, name: str):
            touched.add(name)
            if name not in allowed:
                raise AssertionError(
                    f"display_key read `{name}`, which a drag cannot control — "
                    "see contracts/column-order.json"
                )
            return _row(self._spec).__getattribute__(name)

    for case in _load()["cases"]:
        rows = [Strict(spec) for spec in case["prompts"]]
        sorted(rows, key=display_key)

    assert "sort_order" in touched, "the stand-in never reached the real key"


def test_the_contract_file_is_substantial():
    """A contract nobody can empty by accident.

    Deleting cases would make both suites pass while proving nothing, and that
    is exactly the failure this file exists to prevent.
    """
    data = _load()
    assert len(data["cases"]) >= 10
    names = [c["name"] for c in data["cases"]]
    assert len(set(names)) == len(names), "duplicate case names"
    for case in data["cases"]:
        assert case["why"].strip(), f"{case['name']} has no rationale"
        assert len(case["prompts"]) >= 2, f"{case['name']} cannot express an order"
        assert sorted(case["expected_ids"]) == sorted(p["id"] for p in case["prompts"])


# --------------------------------------------------------------------------
# the THIRD mirror: the SQL used to renumber a column
# --------------------------------------------------------------------------

def test_the_sql_order_agrees_with_display_key():
    """`db._repair_sort_order` renumbers along an ORDER BY, not along the key.

    That expression is a third copy of the same rule, and it is the one nobody
    looks at: a divergence here does not throw, it quietly rewrites sort_order
    into a sequence the board never shows — and every anchored move afterwards
    lands somewhere the user did not point at. Two implementations were already
    pinned against each other; this puts the third in the same harness.
    """
    import sqlite3

    from app.ordering import BOARD_ORDER_SQL, display_key

    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE prompt (id INTEGER, sort_order INTEGER, status TEXT, "
        "blocked INTEGER, tested INTEGER, priority TEXT, test_closely INTEGER)"
    )
    for case in _load()["cases"]:
        conn.execute("DELETE FROM prompt")
        for spec in case["prompts"]:
            conn.execute(
                "INSERT INTO prompt VALUES (?,?,?,?,?,?,?)",
                (
                    spec["id"],
                    spec["sort_order"],
                    spec.get("status", "queued"),
                    int(spec.get("blocked", False)),
                    int(spec.get("tested", False)),
                    spec.get("priority", "normal"),
                    int(spec.get("test_closely", False)),
                ),
            )
        by_sql = [
            row[0]
            for row in conn.execute(f"SELECT id FROM prompt ORDER BY {BOARD_ORDER_SQL}")
        ]
        by_key = [row.id for row in sorted((_row(s) for s in case["prompts"]), key=display_key)]
        assert by_sql == by_key == case["expected_ids"], case["name"]
    conn.close()


def test_the_repair_uses_that_shared_expression():
    """...and the renumbering actually uses it, rather than its own copy."""
    from app import db, ordering

    source = Path(db.__file__).read_text(encoding="utf-8")
    assert "BOARD_ORDER_SQL" in source, "db.py builds its own ORDER BY again"
    assert "CASE WHEN status = 'done'" not in source, "a second copy crept back into db.py"
    assert ordering.BOARD_ORDER_SQL.strip(), "the shared expression is empty"
