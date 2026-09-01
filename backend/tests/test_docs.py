"""The documentation is held to the code by these tests.

Every check here exists because the drift it catches actually happened:

* README prose claimed "290 Tests" while the badges said 1038 — numbers a human
  has to retype are numbers that rot, so the counts are generated now and these
  tests guard the markers the generator writes into.
* Three settings (`CUE_DEV`, `OPTIMIZE_MAX_RETRIES`, `OPTIMIZE_STALE_GRACE`)
  existed in `config.py` and in no documentation at all — including the one that
  turns four production guards off.
* A code comment described `CUE_DEV` as a harmless client preference.

The point is not tidiness. A configuration reference that may drift is worse
than none, because it is trusted.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PY = ROOT / "backend" / "app" / "config.py"
ENV_EXAMPLE = ROOT / ".env.example"
CONFIG_DOC = ROOT / "docs" / "CONFIGURATION.md"
API_DOC = ROOT / "docs" / "API.md"
README = ROOT / "README.md"
CHANGELOG = ROOT / "CHANGELOG.md"
MAIN_PY = ROOT / "backend" / "app" / "main.py"


# --------------------------------------------------------------------------
# helpers — deliberately tolerant of formatting, strict about content
# --------------------------------------------------------------------------

def env_names_in_code() -> set[str]:
    """Every environment variable `config.py` reads.

    ⚠️ The pattern has to allow a newline between `get(` and the name: black
    wraps long calls, and `ATTACHMENT_DIR` sits on its own line. A single-line
    regex silently under-reports and the whole test becomes decoration — that
    happened while writing this file.
    """
    src = CONFIG_PY.read_text(encoding="utf-8")
    return set(re.findall(r'os\.environ\.get\(\s*"([A-Z_][A-Z0-9_]*)"', src))


def env_names_in(path: Path) -> set[str]:
    """Names documented in an .env file (commented-out lines count)."""
    text = path.read_text(encoding="utf-8")
    return set(re.findall(r"^\s*#?\s*([A-Z_][A-Z0-9_]*)=", text, re.M))


def mentions(text: str, name: str) -> bool:
    """Whole-word mention, so `DB_PATH` is not satisfied by `DB_PATH_EXTRA`."""
    return re.search(rf"\b{re.escape(name)}\b", text) is not None


def routes_in_code() -> set[tuple[str, str]]:
    """(METHOD, full path) for every route decorator in the backend."""
    found: set[tuple[str, str]] = set()
    for path in sorted((ROOT / "backend" / "app").rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        prefix_match = re.search(r'APIRouter\((?:[^)]*?)prefix="([^"]*)"', src, re.S)
        prefix = prefix_match.group(1) if prefix_match else ""
        for m in re.finditer(
            r'^@(?:router|api|app)\.(get|post|patch|put|delete)\(\s*"([^"]*)"', src, re.M
        ):
            found.add((m.group(1).upper(), prefix + m.group(2)))
    return found


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------

def test_every_setting_is_in_env_example():
    undocumented = sorted(env_names_in_code() - env_names_in(ENV_EXAMPLE))
    assert not undocumented, (
        "These settings exist in config.py but not in .env.example: "
        f"{undocumented}. Anyone deploying this cannot know they exist."
    )


def test_env_example_invents_no_settings():
    phantom = sorted(env_names_in(ENV_EXAMPLE) - env_names_in_code())
    assert not phantom, (
        f".env.example documents settings the code never reads: {phantom}. "
        "Setting one of these does nothing, which is worse than not knowing."
    )


def test_every_setting_is_in_the_configuration_reference():
    doc = CONFIG_DOC.read_text(encoding="utf-8")
    missing = sorted(n for n in env_names_in_code() if not mentions(doc, n))
    assert not missing, f"docs/CONFIGURATION.md does not mention: {missing}"


def test_configuration_reference_invents_no_settings():
    doc = CONFIG_DOC.read_text(encoding="utf-8")
    # Only look at names in a table cell (`NAME`), not prose like CSRF or WAL.
    documented = set(re.findall(r"`([A-Z_][A-Z0-9_]{3,})`", doc))
    known = env_names_in_code() | {
        # Referenced by name in the prose but not read from the environment.
        "PRAGMA",
    }
    phantom = sorted(documented - known)
    assert not phantom, f"docs/CONFIGURATION.md documents unknown settings: {phantom}"


def test_the_dev_switch_is_documented_as_dangerous():
    """CUE_DEV turns off four production guards. Whatever else the docs say
    about it, they have to say that."""
    doc = CONFIG_DOC.read_text(encoding="utf-8")
    section = doc[doc.index("CUE_DEV"):]
    assert "niemals" in section.lower() or "never" in section.lower(), (
        "CUE_DEV is documented without warning against using it in production"
    )


# --------------------------------------------------------------------------
# API reference
# --------------------------------------------------------------------------

def test_every_endpoint_is_documented():
    doc = API_DOC.read_text(encoding="utf-8")
    missing = sorted(
        f"{method} {path}"
        for method, path in routes_in_code()
        if f"`{path}`" not in doc
    )
    assert not missing, f"docs/API.md is missing: {missing}"


def test_api_reference_documents_no_phantom_endpoints():
    doc = API_DOC.read_text(encoding="utf-8")
    real = {path for _, path in routes_in_code()}
    # Table rows only: | `GET` | `/path` | … |
    documented = set(re.findall(r"^\| `[A-Z]+` \| `([^`]+)` \|", doc, re.M))
    phantom = sorted(documented - real)
    assert not phantom, f"docs/API.md documents endpoints that do not exist: {phantom}"


def test_every_documented_endpoint_names_its_method():
    """A path without its verb is not a reference — `/prompts` is four things."""
    doc = API_DOC.read_text(encoding="utf-8")
    rows = re.findall(r"^\|([^|]*)\|([^|]*)\|", doc, re.M)
    verbs = {"GET", "POST", "PATCH", "PUT", "DELETE"}
    for method_cell, path_cell in rows:
        if "/" in path_cell and "`" in path_cell and "Pfad" not in method_cell:
            assert any(v in method_cell for v in verbs), (
                f"row documents a path without a method: {path_cell.strip()}"
            )


# --------------------------------------------------------------------------
# version, changelog, generated blocks
# --------------------------------------------------------------------------

def app_version() -> str:
    m = re.search(r'version="(\d+\.\d+\.\d+)"', MAIN_PY.read_text(encoding="utf-8"))
    assert m, 'backend/app/main.py has no version="X.Y.Z"'
    return m.group(1)


def test_current_version_has_a_changelog_entry():
    version = app_version()
    text = CHANGELOG.read_text(encoding="utf-8")
    assert f"## [{version}]" in text, (
        f"CHANGELOG.md has no entry for the shipped version {version}"
    )


def test_changelog_versions_are_unique_and_ordered_newest_first():
    versions = re.findall(r"^## \[(\d+)\.(\d+)\.(\d+)\]", CHANGELOG.read_text(encoding="utf-8"), re.M)
    tuples = [tuple(int(p) for p in v) for v in versions]
    assert len(tuples) == len(set(tuples)), "CHANGELOG.md lists a version twice"
    assert tuples == sorted(tuples, reverse=True), (
        "CHANGELOG.md entries are not newest-first"
    )


#: Every block `update-badges.mjs` writes. Kept in one place so the two tests
#: below cannot disagree about what counts as generated.
GENERATED_BLOCKS = ["hero:dynamic", "badges:dynamic", "stack:dynamic", "tests:dynamic"]


@pytest.mark.parametrize("marker", GENERATED_BLOCKS)
def test_readme_generated_blocks_have_their_markers(marker: str):
    """The generator throws when a marker is gone rather than appending a second
    copy — so a missing marker means the numbers silently stop updating.

    ⚠️ The markers have to be matched as STANDALONE LINES, not as substrings.
    The README explains its own marker names in prose, in backticks — and a
    plain `in text` check is satisfied by that explanation, so the test stayed
    green with the real block renamed. Found by mutation, which is the only way
    this class of bug shows up.
    """
    text = README.read_text(encoding="utf-8")
    for line in (f"<!-- {marker} -->", f"<!-- /{marker} -->"):
        assert re.search(rf"^{re.escape(line)}$", text, re.M), (
            f"README.md lost the {line} line; badge updates would fail"
        )


def test_readme_does_not_restate_the_version_by_hand():
    """The version lives in one place. A second, hand-typed copy is the drift."""
    version = app_version()
    text = README.read_text(encoding="utf-8")
    # ⚠️ Strip EVERY generated block, not one named one. The version moved into
    # the new hero block and this test failed on a value it should never have
    # been looking at — a list of blocks that has to be extended by hand is the
    # same rot the test exists to catch.
    outside_badges = text
    for block in GENERATED_BLOCKS:
        outside_badges = re.sub(
            rf"<!-- {re.escape(block)} -->.*?<!-- /{re.escape(block)} -->",
            "",
            outside_badges,
            flags=re.S,
        )
    assert version not in outside_badges, (
        f"README.md repeats the version {version} outside the generated badge block"
    )


# --------------------------------------------------------------------------
# links
# --------------------------------------------------------------------------

DOC_FILES = [
    ROOT / "README.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "SECURITY.md",
    *sorted((ROOT / "docs").glob("*.md")),
]


@pytest.mark.parametrize("doc", DOC_FILES, ids=lambda p: p.name)
def test_relative_links_point_at_something_that_exists(doc: Path):
    """A dead link is the most common kind of documentation rot and the easiest
    to catch. External URLs and anchors are out of scope."""
    text = doc.read_text(encoding="utf-8")
    broken = []
    for target in re.findall(r"\]\(([^)]+)\)", text):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        path = (doc.parent / target.split("#", 1)[0]).resolve()
        if not path.exists():
            broken.append(target)
    assert not broken, f"{doc.name} links to missing files: {broken}"
