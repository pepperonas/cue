#!/usr/bin/env python3
"""Generate an Argon2id hash for APP_PASSWORD_HASH in your .env.

Usage:
    python scripts/gen_password_hash.py
    # then paste the printed line into .env

The password is read without echo. Nothing is stored on disk by this script.
"""
from __future__ import annotations

import getpass
import sys

try:
    from argon2 import PasswordHasher
except ImportError:  # pragma: no cover
    sys.exit(
        "argon2-cffi is not installed. Run:\n"
        "  uv pip install argon2-cffi   # or: pip install argon2-cffi"
    )


def main() -> int:
    pw1 = getpass.getpass("New cue password: ")
    if len(pw1) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    pw2 = getpass.getpass("Repeat password:  ")
    if pw1 != pw2:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    digest = PasswordHasher().hash(pw1)
    print("\nAdd this line to your .env:\n")
    print(f"APP_PASSWORD_HASH={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
