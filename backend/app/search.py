"""Substring search helpers.

SQL LIKE reads `%` and `_` as wildcards, so pasting a user's term straight into
`%{term}%` leaks them into the pattern: searching for `%` matched every row and
`snake_case` matched `snakeXcase`. Every place that builds a LIKE pattern goes
through here and passes `LIKE_ESCAPE` on to the query, so the term is matched
literally.

Kept FastAPI- and DB-free so the escaping rules are unit-testable on their own.
"""
from __future__ import annotations

#: Escape character handed to SQL via ``LIKE ... ESCAPE``.
LIKE_ESCAPE = "\\"


def escape_like(term: str) -> str:
    """Neutralize LIKE wildcards in a user-supplied term.

    The escape character itself has to go first, otherwise the backslashes we
    add for `%`/`_` would be escaped a second time.
    """
    out = term.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
    for wildcard in ("%", "_"):
        out = out.replace(wildcard, LIKE_ESCAPE + wildcard)
    return out


def contains_pattern(term: str) -> str:
    """Build `%term%` with the term's own wildcards escaped."""
    return f"%{escape_like(term)}%"
