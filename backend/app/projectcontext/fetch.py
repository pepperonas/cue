"""Turn a repository into the context text the AI reads.

Two halves: `gather()` talks to GitHub, `build_text()` is pure and holds every
rule about what goes in and how much — that is the part worth testing.
"""
from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass, field

from . import github

#: Whole context, in characters (~15 000 tokens). It travels with every
#: optimization of the project, so it is capped — prompt caching makes the
#: repeats cheap, not free.
MAX_TOTAL_CHARS = 60_000
MAX_CLAUDE_MD = 30_000
MAX_README = 12_000
MAX_MANIFEST = 4_000
MAX_COMMITS = 30
MAX_PATHS = 400

README_NAMES = ("README.md", "README.de.md", "README.rst", "README.txt", "README")
MANIFESTS = (
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "build.gradle.kts",
    "build.gradle",
    "pom.xml",
    "composer.json",
)

#: Directories whose contents say nothing about the project's structure.
_SKIP_DIRS = {
    "node_modules", "dist", "build", ".git", "vendor", "venv", ".venv", "__pycache__",
    ".next", ".gradle", "target", "coverage", ".idea", ".vscode", "out", ".cache",
}
_SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip", ".gz",
    ".jar", ".so", ".dylib", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".wav",
    ".lock", ".map", ".min.js", ".db", ".sqlite", ".keystore", ".jks", ".apk",
}

REPO_RE = re.compile(r"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$")

INTRO = (
    "Hintergrund zum Projekt, aus dem Repository gelesen. Nutze ihn, um zu "
    "erkennen, was es schon gibt und wovon etwas abhängt. Er ist NICHT Teil "
    "des Prompts: schreibe ihn nicht ab, und erfinde keine Pfade oder Dateien, "
    "die hier nicht vorkommen."
)


def valid_repo(value: str) -> bool:
    return bool(REPO_RE.match(value or "")) and ".." not in value


def valid_ref(value: str) -> bool:
    return bool(value) and len(value) <= 200 and ".." not in value and not re.search(r"\s", value) \
        and not value.startswith("-")


@dataclass
class Parts:
    claude_md: str = ""
    readme: str = ""
    readme_name: str = ""
    manifest: str = ""
    manifest_name: str = ""
    paths: list[str] = field(default_factory=list)
    commits: list[str] = field(default_factory=list)


def keep_path(path: str) -> bool:
    parts = path.split("/")
    if any(p in _SKIP_DIRS for p in parts[:-1]):
        return False
    low = path.lower()
    return not any(low.endswith(ext) for ext in _SKIP_EXT)


def filter_paths(paths: list[str]) -> list[str]:
    return sorted(p for p in paths if keep_path(p))


def cut(text: str, limit: int) -> str:
    """Shorten and SAY so — a context that looks complete is read as complete."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"\n\n[… gekürzt, {len(text) - limit} Zeichen fehlen]"


def build_text(repo: str, ref: str, sha: str, parts: Parts) -> str:
    """The context block. Order = importance; every section has its own cap."""
    out = [f"## Projektkontext: {repo} @ {ref} ({sha[:7]})", "", INTRO]

    def section(title: str, body: str) -> None:
        if body:
            out.extend(["", f"### {title}", "", body])

    section("CLAUDE.md", cut(parts.claude_md, MAX_CLAUDE_MD))
    section(parts.readme_name or "README", cut(parts.readme, MAX_README))
    section(parts.manifest_name or "Manifest", cut(parts.manifest, MAX_MANIFEST))
    if parts.commits:
        section(
            "Letzte Commits",
            "\n".join(f"- {c}" for c in parts.commits[:MAX_COMMITS]),
        )

    used = len("\n".join(out))
    room = MAX_TOTAL_CHARS - used - 200
    paths = filter_paths(parts.paths)
    if paths and room > 0:
        shown: list[str] = []
        size = 0
        for p in paths[:MAX_PATHS]:
            if size + len(p) + 1 > room:
                break
            shown.append(p)
            size += len(p) + 1
        missing = len(paths) - len(shown)
        tree = "\n".join(shown)
        if missing:
            tree += f"\n[… {missing} weitere Dateien nicht aufgeführt]"
        section(f"Dateien ({len(paths)})", tree)

    return "\n".join(out)


def _quote(path: str) -> str:
    return urllib.parse.quote(path, safe="/")


def resolve(token: str, repo: str, ref: str | None) -> tuple[str, str]:
    """(ref actually used, head sha). Empty ref = the default branch."""
    if not ref:
        meta = github.request("GET", f"{github.API}/repos/{repo}", token=token) or {}
        ref = meta.get("default_branch") or "main"
    sha = github.request(
        "GET",
        f"{github.API}/repos/{repo}/commits/{_quote(ref)}",
        token=token,
        accept=github.SHA,
    )
    return ref, (sha or "").strip()


def _file(token: str, repo: str, sha: str, path: str) -> str:
    try:
        return github.request(
            "GET",
            f"{github.API}/repos/{repo}/contents/{_quote(path)}?ref={sha}",
            token=token,
            accept=github.RAW,
        ) or ""
    except github.GitHubError as exc:
        if exc.status == 404:
            return ""
        raise


def gather(token: str, repo: str, sha: str) -> Parts:
    parts = Parts()
    tree = github.request(
        "GET", f"{github.API}/repos/{repo}/git/trees/{sha}?recursive=1", token=token
    ) or {}
    blobs = [e.get("path", "") for e in tree.get("tree", []) if e.get("type") == "blob"]
    parts.paths = blobs
    root = {p for p in blobs if "/" not in p}

    if "CLAUDE.md" in root:
        parts.claude_md = _file(token, repo, sha, "CLAUDE.md")
    for name in README_NAMES:
        if name in root:
            parts.readme, parts.readme_name = _file(token, repo, sha, name), name
            break
    for name in MANIFESTS:
        if name in root:
            parts.manifest, parts.manifest_name = _file(token, repo, sha, name), name
            break

    commits = github.request(
        "GET", f"{github.API}/repos/{repo}/commits?sha={sha}&per_page={MAX_COMMITS}", token=token
    ) or []
    parts.commits = [
        ((c.get("commit") or {}).get("message") or "").splitlines()[0][:160]
        for c in commits
        if (c.get("commit") or {}).get("message")
    ]
    return parts


def with_context(prompt: str, context: str) -> str:
    """Inline form for executors that take ONE text (the Claude Code CLI)."""
    if not context:
        return prompt
    return f"{context}\n\n---\n\n{prompt}"


__all__ = [
    "MAX_TOTAL_CHARS",
    "Parts",
    "build_text",
    "cut",
    "filter_paths",
    "gather",
    "keep_path",
    "resolve",
    "valid_ref",
    "valid_repo",
    "with_context",
]
