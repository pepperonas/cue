"""Kein Zugangsdatum im veröffentlichten Baum — als Test, nicht als Vorsatz.

`pepperonas/cue` ist ein **öffentliches** Repo. Was hier einmal eingecheckt
wurde, ist lesbar, und ein `git rm` später nimmt es aus dem Baum, nicht aus der
Historie. Die Regel „Geheimnisse stehen nur in der `.env` auf dem Server" ist
deshalb genau so viel wert wie ihre Durchsetzung: `.gitignore` fängt die Datei,
die man erwartet hat — dieser Test fängt den Schlüssel, der in einer Datei
landet, an die niemand gedacht hat (ein Beispiel im Kommentar, ein Fixture, ein
Ausschnitt einer Fehlermeldung in der Doku).

Geprüft wird, was `git ls-files` meldet, also exakt das, was veröffentlicht
wird — nicht der Arbeitsbaum.

⚠️ Die Muster werden zur Laufzeit ZUSAMMENGESETZT. Eine Wache, die ihr eigenes
Suchwort im Klartext trägt, findet als Erstes sich selbst; genau das ist im Haus
schon einmal passiert (all-uebersicht, PIN-Wächter).

⚠️ Und: eine Wache, die 0 meldet, ist erst nach der GEGENPROBE glaubwürdig —
`test_the_scanner_actually_finds_a_planted_secret` legt je ein echtes Muster in
eine Wegwerfdatei und verlangt, dass es gefunden wird.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# (Name, Muster). Jedes Muster wird zusammengesetzt, damit diese Datei nicht
# ihren eigenen Suchbegriff findet.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Anthropic-API-Key", re.compile("sk-" + r"ant-[A-Za-z0-9_-]{20,}")),
    ("Google-Client-Secret", re.compile("GOCSPX" + r"-[A-Za-z0-9_-]{10,}")),
    ("GitHub-Token", re.compile(r"\b(?:ghp|gho|ghu|ghs)" + r"_[A-Za-z0-9]{20,}")),
    ("GitHub-PAT", re.compile("github" + r"_pat_[A-Za-z0-9_]{20,}")),
    ("privater Schlüssel", re.compile("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----")),
    ("OpenAI-Key", re.compile("sk-" + r"proj-[A-Za-z0-9_-]{20,}")),
]

# Umgebungsvariablen, die ein Geheimnis TRAGEN. Ein Wert dahinter ist nur dann
# in Ordnung, wenn er leer oder ein erkennbarer Platzhalter ist — `.env.example`
# wird deshalb mitgeprüft und besteht, weil dort nichts steht.
SECRET_ENV_NAMES = (
    "SECRET_KEY",
    "GOOGLE_CLIENT_SECRET",
    "RUNNER_TOKEN",
    "CAPTURE_TOKEN",
    "ANTHROPIC_API_KEY",
    "CUE_API_KEY",
)
ASSIGNMENT = re.compile(
    r"^[^\S\n]*(?:export[^\S\n]+)?(" + "|".join(SECRET_ENV_NAMES) + r")[^\S\n]*[=:][^\S\n]*([^\s#]{8,})",
    re.MULTILINE,
)
# Was als Platzhalter durchgeht: leer, ein <…>-Feld, ein ___-Feld, "changeme",
# eine Zeile, die nur aus Punkten/Sternen besteht, oder ein Verweis auf die
# Erzeugung (`$(openssl …)`).
PLACEHOLDER = re.compile(
    r"^(?:\"\"|''|<[^>]*>|__[A-Z_]+__|\$\{?[A-Za-z_].*|changeme|CHANGEME|dev|"
    r"[.*xX]{3,}|your[-_].*|\.\.\.)$"
)

MAX_BYTES = 4_000_000

# Eine Zeile, die dieses Wort traegt, wird uebersprungen. Ein Waechter ohne
# Ausnahme wird beim ersten Mal abgeschaltet, an dem er laestig recht hat — und
# ein abgeschalteter Waechter faengt gar nichts mehr. Die Markierung steht in
# der Zeile selbst, taucht also im Diff auf und muss begruendet werden.
WAIVER = "attrappe"


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout
    return [REPO / name for name in out.split("\0") if name]


def scan(paths: list[Path]) -> list[str]:
    """Jeder Fund als eine Zeile 'datei:zeile: was'. Leer = sauber."""
    findings: list[str] = []
    for path in paths:
        try:
            if not path.is_file() or path.stat().st_size > MAX_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # binär oder weg — beides trägt kein lesbares Geheimnis
        rel = path.relative_to(REPO) if path.is_relative_to(REPO) else path
        zeilen = text.split("\n")

        def verzichtet(offset: int) -> bool:
            nr = text.count("\n", 0, offset)
            return WAIVER in zeilen[nr].lower()

        for label, pattern in PATTERNS:
            for match in pattern.finditer(text):
                if verzichtet(match.start()):
                    continue
                findings.append(f"{rel}:{text.count(chr(10), 0, match.start()) + 1}: {label}")
        for match in ASSIGNMENT.finditer(text):
            name, value = match.group(1), match.group(2).strip("\"',")
            if not value or PLACEHOLDER.match(value) or verzichtet(match.start()):
                continue
            line = text.count("\n", 0, match.start()) + 1
            findings.append(f"{rel}:{line}: {name} mit einem Wert belegt")
    return findings


def test_no_credentials_in_the_published_tree():
    findings = scan(tracked_files())
    assert not findings, (
        "Zugangsdaten im ÖFFENTLICHEN Repo gefunden:\n  "
        + "\n  ".join(findings)
        + "\n\nAus dem Baum nehmen reicht nicht — die Historie trägt es weiter. "
        "Das betroffene Geheimnis gilt als verbrannt und muss rotiert werden."
    )


def test_the_scanner_actually_finds_a_planted_secret(tmp_path: Path):
    """Gegenprobe: ohne sie beweist eine leere Liste nur, dass gesucht wurde."""
    planted = {
        "key.txt": "ANTHROPIC_API_KEY=sk-" + "ant-" + "A" * 40,
        "client.json": '{"secret": "GOCSPX' + "-" + "b" * 24 + '"}',
        "id_ed25519": "-----BEGIN OPENSSH PRIVATE " + "KEY-----\nabc\n",
        "ci.yml": "  RUNNER_TOKEN: " + "9" * 32,
    }
    for name, body in planted.items():
        (tmp_path / name).write_text(body, encoding="utf-8")
    for name in planted:
        found = scan([tmp_path / name])
        assert found, f"Muster in {name} nicht erkannt"


def test_a_placeholder_is_not_a_finding(tmp_path: Path):
    """Sonst wäre `.env.example` rot und der Wächter würde abgeschaltet."""
    (tmp_path / ".env.example").write_text(
        "SECRET_KEY=\nGOOGLE_CLIENT_SECRET=\nRUNNER_TOKEN=<hier einsetzen>\n"
        "CAPTURE_TOKEN=__SET_ME__\n",
        encoding="utf-8",
    )
    assert scan([tmp_path / ".env.example"]) == []
