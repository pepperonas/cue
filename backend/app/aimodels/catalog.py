"""Provider-Katalog und die Start-Modelle.

⚠️ Die Modellbezeichnungen sind RECHERCHIERT, nicht aus dem Gedächtnis gesetzt.
Quellen und Stand stehen an jedem Block. Wer sie auffrischt, aktualisiert
`STAND` mit — eine Liste ohne Datum ist eine Liste, der niemand ansieht, wie
alt sie ist (dieselbe Regel wie `optimization/pricing.py:STATE`).

Die Provider sind bewusst eine offene Liste aus Zeichenketten und KEIN
Datenbank-Enum: ein neuer Anbieter ist dann ein Eintrag hier plus optional ein
Eintrag in `PROVIDERS` für Farbe und Symbol — ein unbekannter Provider-Wert
bleibt gültig und wird neutral dargestellt.
"""
from __future__ import annotations

from dataclasses import dataclass

#: Stand der Recherche unten.
STAND = "2026-09-20"


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    #: Kurzzeichen für den Badge, wenn der Modellname allein nicht verrät,
    #: aus welchem Ökosystem er stammt.
    kuerzel: str
    color: str


#: Bekannte Anbieter. Ein Modell darf einen Provider tragen, der hier fehlt —
#: dann greift `unbekannt()`.
PROVIDERS: dict[str, ProviderSpec] = {
    "anthropic": ProviderSpec("anthropic", "Claude Code", "CC", "#c96442"),
    "openai": ProviderSpec("openai", "OpenAI Codex", "CX", "#10a37f"),
    "custom": ProviderSpec("custom", "Eigenes", "··", "#7d7d8a"),
}

DEFAULT_PROVIDER = "custom"


def provider(pid: str | None) -> ProviderSpec:
    """Den Anbieter auflösen — Unbekanntes bleibt gültig, nur neutral."""
    known = PROVIDERS.get((pid or "").strip().lower())
    if known is not None:
        return known
    if pid:
        # Kein Rückfall auf „Eigenes": der Nutzer hat einen Namen vergeben, und
        # den zu überschreiben wäre eine stille Korrektur seiner Eingabe.
        return ProviderSpec(pid, pid, (pid[:2] or "··").upper(), PROVIDERS["custom"].color)
    return PROVIDERS[DEFAULT_PROVIDER]


@dataclass(frozen=True)
class DefaultModel:
    name: str
    provider: str
    #: Die Kennung, mit der das Modell wirklich angesprochen wird.
    api_id: str
    description: str
    default: bool = False


# ---------------------------------------------------------------------------
# Claude Code
#
# Quelle: https://platform.claude.com/docs/en/about-claude/models/overview
#         (abgerufen 2026-09-20) — Spalte „Claude API ID"/„Claude API alias".
# Die CLI kennt zusätzlich die Kurz-Aliasse `fable`/`opus`/`sonnet`/`haiku`
# (Quelle: https://docs.anthropic.com/en/docs/claude-code/model-config,
# abgerufen 2026-09-20). Hinterlegt ist die VOLLE API-Kennung, weil sie
# eindeutig ist; der Alias steht in der Beschreibung.
CLAUDE: tuple[DefaultModel, ...] = (
    DefaultModel(
        "Claude Opus 5",
        "anthropic",
        "claude-opus-5",
        "Für komplexe agentische Arbeit. CLI-Alias: opus.",
        default=True,
    ),
    DefaultModel(
        "Claude Fable 5.1",
        "anthropic",
        "claude-fable-5-1",
        "Für anspruchsvolles Schlussfolgern über lange Strecken. CLI-Alias: fable.",
    ),
    DefaultModel(
        "Claude Sonnet 5",
        "anthropic",
        "claude-sonnet-5",
        "Bestes Verhältnis aus Tempo und Tiefe. CLI-Alias: sonnet.",
    ),
    DefaultModel(
        "Claude Haiku 4.5",
        "anthropic",
        "claude-haiku-4-5",
        "Das schnellste Modell. CLI-Alias: haiku.",
    ),
)

# ---------------------------------------------------------------------------
# OpenAI Codex
#
# Quelle: https://developers.openai.com/codex/models → leitet dauerhaft (308)
#         auf https://learn.chatgpt.com/docs/models (abgerufen 2026-09-20).
# Aufgenommen sind die dort als „Recommended" geführten Modelle; die älteren
# (gpt-5.5, gpt-5.4, gpt-5.4-mini) tragen dort ein Abkündigungsdatum und
# gehören deshalb nicht in eine frische Voreinstellung.
CODEX: tuple[DefaultModel, ...] = (
    DefaultModel("Codex Astra", "openai", "gpt-6-astra", "Empfohlen für Codex."),
    DefaultModel("Codex 5.6 Sol", "openai", "gpt-5.6-sol", ""),
    DefaultModel("Codex 5.6 Terra", "openai", "gpt-5.6-terra", ""),
    DefaultModel("Codex 5.6 Luna", "openai", "gpt-5.6-luna", ""),
)

DEFAULTS: tuple[DefaultModel, ...] = CLAUDE + CODEX


def claude_code_empfehlung(api_id: str | None) -> str | None:
    """Welcher Katalog-Eintrag zu dem Modell passt, das die Optimierung nutzte.

    Die Optimierung meldet zurück, womit sie gerechnet hat — mal die volle
    Kennung (`claude-opus-5`), mal den CLI-Alias (`opus`), mal einen Zusatz
    wie `claude-opus-5[1m]`. Alle drei sollen denselben Eintrag treffen.
    Rückgabe ist die `api_id` aus dem Katalog oder None.
    """
    roh = (api_id or "").strip().lower()
    if not roh:
        return None
    # Zusätze in Klammern abschneiden: `claude-opus-5[1m]` ist dasselbe Modell.
    kern = roh.split("[")[0].strip()
    for modell in CLAUDE:
        if kern == modell.api_id:
            return modell.api_id
    # Alias-Weg: der letzte Namensteil der Kennung ist der CLI-Alias.
    for modell in CLAUDE:
        alias = modell.api_id.replace("claude-", "").split("-")[0]
        if kern == alias:
            return modell.api_id
    return None
