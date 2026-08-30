"""The two dependency lists must agree.

`pyproject.toml` is what `uv` installs locally and what the test suite runs
against; `requirements.txt` is what the DOCKER IMAGE installs. Nothing reads
both, so adding a package to one of them produces a green local suite and an
image that is missing it — and the failure lands at import time in production,
after the deploy's health gate has already swapped the container.

That is not hypothetical: it happened when `cryptography` and `anthropic` were
added for the per-user API keys. The site answered 502 until the second list
was updated. This file is the reason it cannot happen quietly again.
"""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PYPROJECT = BACKEND / "pyproject.toml"
REQUIREMENTS = BACKEND / "requirements.txt"

#: `name>=version` → `name`, lower-cased, extras stripped (`uvicorn[standard]`).
_NAME = re.compile(r"^([A-Za-z0-9._-]+)(\[[^\]]*\])?")


def _package(spec: str) -> str:
    match = _NAME.match(spec.strip())
    assert match, f"unparsable requirement: {spec!r}"
    return match.group(1).lower().replace("_", "-")


def _from_pyproject() -> dict[str, str]:
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    return {_package(dep): dep.strip() for dep in data["project"]["dependencies"]}


def _from_requirements() -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out[_package(line)] = line
    return out


def test_the_two_lists_hold_the_same_packages():
    """A package in one and not the other is the exact production outage this
    file exists for."""
    py = _from_pyproject()
    req = _from_requirements()
    missing_in_image = sorted(set(py) - set(req))
    assert not missing_in_image, (
        f"in pyproject.toml but NOT in requirements.txt: {missing_in_image}. "
        "The Docker image installs requirements.txt — this ships an image that "
        "cannot import."
    )
    missing_locally = sorted(set(req) - set(py))
    assert not missing_locally, (
        f"in requirements.txt but not in pyproject.toml: {missing_locally}. "
        "The test suite then runs against a different set than production."
    )


def test_the_version_constraints_match_too():
    """Same packages is not enough: two different floors mean the image can
    install an older release than anything was ever tested against."""
    py = _from_pyproject()
    req = _from_requirements()
    differing = sorted(
        f"{name}: pyproject={py[name]!r} requirements={req[name]!r}"
        for name in set(py) & set(req)
        if py[name] != req[name]
    )
    assert not differing, f"the two lists pin different versions: {differing}"


def test_the_lists_are_not_empty():
    """A comparison of two empty sets passes and proves nothing."""
    assert len(_from_pyproject()) >= 5
    assert len(_from_requirements()) >= 5
