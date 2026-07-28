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


def display_key(prompt) -> tuple:  # noqa: ANN001 - duck-typed on purpose
    """Sort key of the order the BOARD shows — mirror of lib/order.ts.

    The anchor in a move request names a card the user can see, so the server
    has to insert into the same sequence. While these two drifted apart, a drag
    could be saved and still have no visible effect: a queued column stores
    blocked prompts inline but displays them at the bottom, so "put it before
    #184" landed in the middle of the stored order and changed nothing on
    screen — it looked exactly like reordering wasn't saved.

    Only stored fields may take part, and every rule has to be one a drag can
    work within: a rule the user cannot override (like ordering by execution
    time) makes their drag a no-op.
    """
    tested_last = 1 if (prompt.status == "done" and prompt.tested) else 0
    return (1 if prompt.blocked else 0, tested_last, prompt.sort_order, prompt.id)


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
