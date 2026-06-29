"""Project-path whitelist (mirrors the backend; the runner re-validates)."""
from __future__ import annotations

import posixpath


def is_path_allowed(path: str, allowed_bases: list[str]) -> bool:
    """True if `path` is absolute, free of `..`/NUL escapes, and sits under a base."""
    if not path or "\x00" in path or not allowed_bases:
        return False
    norm = posixpath.normpath(path)
    if not posixpath.isabs(norm) or ".." in norm.split("/"):
        return False
    return any(
        norm == base or norm.startswith(base + "/")
        for base in (posixpath.normpath(b) for b in allowed_bases)
    )
