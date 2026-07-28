"""Where a dragged prompt lands inside its column.

Ordering used to be computed in the browser: the client numbered the cards it
could see 1..n and sent that. With a project filter or a search active it could
only see a subset, so the numbering collided with the prompts it had filtered
out — in production 14 prompts ended up sharing sort_order 1, one per project.

So the client no longer sends positions, it sends an ANCHOR ("put it before
prompt 42"). The anchor is a real prompt id and therefore means the same thing
whether or not a filter is active; the server resolves it against the full
column and renumbers everything.

Pure list arithmetic, kept free of FastAPI and the DB so the rules are unit
testable on their own.
"""
from __future__ import annotations


def insert_block(
    ids: list[int],
    moved: list[int],
    *,
    before_id: int | None = None,
    after_id: int | None = None,
    top: bool = False,
) -> list[int]:
    """Return `ids` with `moved` inserted as one block at the anchored position.

    `ids` is the target column in display order; the moved prompts are pulled
    out of it first, so this works whether they come from this column or from
    another one. `moved` keeps its own order — dragging a multi-selection must
    not shuffle the selection.

    Precedence is before_id, then after_id, then `top`, then append. An anchor
    that is not in the column — a concurrent change, an id belonging to another
    tenant, or one of the moved prompts itself — is ignored and falls back to
    top/append rather than failing the drag: landing at a column edge is a far
    better outcome for a rare race than a drag that bounces back.
    """
    block = list(dict.fromkeys(moved))  # de-dupe, keep order
    rest = [i for i in ids if i not in set(block)]
    if before_id is not None and before_id in rest:
        index = rest.index(before_id)
    elif after_id is not None and after_id in rest:
        index = rest.index(after_id) + 1
    elif top:
        index = 0
    else:
        index = len(rest)
    return rest[:index] + block + rest[index:]
