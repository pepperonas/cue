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
STAND = "2026-10-04"

#: Fassung des Start-Katalogs. Jeder Eintrag trägt, ab welcher Fassung er dazu
#: gehört (`seit`). Ein Konto, das eine ältere Fassung bekommen hat, erhält beim
#: nächsten Abruf NUR die neueren Einträge — was es bewusst gelöscht hat, bleibt
#: gelöscht, und sein Standardmodell wird nicht angefasst.
KATALOG_VERSION = 2


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
    "google": ProviderSpec("google", "Antigravity · Gemini", "AG", "#4285f4"),
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
    #: Ab welcher `KATALOG_VERSION` der Eintrag zum Start-Katalog gehört.
    seit: int = 1


# ---------------------------------------------------------------------------
# Claude Code
#
# Quelle: https://platform.claude.com/docs/en/about-claude/models/overview
#         (abgerufen 2026-10-04) — Spalte „Claude API ID"/„Claude API alias".
# Die CLI kennt zusätzlich die Kurz-Aliasse `fable`/`opus`/`sonnet`/`haiku`.
# Hinterlegt ist die VOLLE API-Kennung, weil sie eindeutig ist; der Alias steht
# in der Beschreibung. Opus 5 und Sonnet 5 führt die Seite inzwischen als
# „Legacy (still available)" — sie stehen unten in `CLAUDE_LEGACY`, damit eine
# Optimierung, die sie noch meldet, ihren Katalog-Eintrag weiter findet.
CLAUDE: tuple[DefaultModel, ...] = (
    DefaultModel(
        "Claude Opus 5.5",
        "anthropic",
        "claude-opus-5-5",
        "Für lange agentische Coding- und Wissensarbeit. CLI-Alias: opus.",
        default=True,
        seit=2,
    ),
    DefaultModel(
        "Claude Fable 5.1",
        "anthropic",
        "claude-fable-5-1",
        "Für anspruchsvolles Schlussfolgern über lange Strecken. CLI-Alias: fable.",
    ),
    DefaultModel(
        "Claude Sonnet 5.5",
        "anthropic",
        "claude-sonnet-5-5",
        "Bestes Verhältnis aus Tempo und Tiefe. CLI-Alias: sonnet.",
        seit=2,
    ),
    DefaultModel(
        "Claude Haiku 4.5",
        "anthropic",
        "claude-haiku-4-5",
        "Das schnellste Modell. CLI-Alias: haiku.",
    ),
)

#: Nicht mehr im Start-Katalog, aber bei Anthropic weiter verfügbar und in
#: bestehenden Konten vorhanden (Fassung 1).
CLAUDE_LEGACY: tuple[DefaultModel, ...] = (
    DefaultModel("Claude Opus 5", "anthropic", "claude-opus-5", ""),
    DefaultModel("Claude Sonnet 5", "anthropic", "claude-sonnet-5", ""),
)

# ---------------------------------------------------------------------------
# OpenAI Codex
#
# Quelle: https://learn.chatgpt.com/docs/models (Ziel der dauerhaften
#         Weiterleitung von developers.openai.com/codex/models, abgerufen
#         2026-10-04). Aufgenommen sind die als „Recommended" geführten Modelle.
#         Die 5.6-Reihe aus Fassung 1 führt die Seite nicht mehr; bestehende
#         Konten behalten ihre Einträge (deaktivieren statt löschen).
CODEX: tuple[DefaultModel, ...] = (
    DefaultModel(
        "Codex Astra",
        "openai",
        "gpt-6-astra",
        "Das stärkste Codex-Modell für komplexe Arbeit.",
    ),
    DefaultModel(
        "Codex 6.1 Sol",
        "openai",
        "gpt-6.1-sol",
        "Nahe an Astra, deutlich günstiger.",
        seit=2,
    ),
    DefaultModel(
        "Codex 6 Luna",
        "openai",
        "gpt-6-luna",
        "Effizient für fokussierte, wiederkehrende Aufgaben.",
        seit=2,
    ),
)

# ---------------------------------------------------------------------------
# Google Antigravity · Gemini
#
# Quellen: https://ai.google.dev/gemini-api/docs/antigravity-agent (Werte für
#          `agent_config.model`, Standard gemini-3.8-flash) und
#          https://ai.google.dev/gemini-api/docs/models (abgerufen 2026-10-04).
# Ein Pro-Modell bietet der Antigravity-Agent nicht an; gemini-3.1-pro-preview
# ist das neueste Pro der Gemini-API und steht hier für Arbeit außerhalb davon.
GEMINI: tuple[DefaultModel, ...] = (
    DefaultModel(
        "Gemini 3.8 Flash",
        "google",
        "gemini-3.8-flash",
        "Standard in Antigravity — Reasoning, Coding, Tool-Nutzung.",
        seit=2,
    ),
    DefaultModel(
        "Gemini 3.1 Pro (Preview)",
        "google",
        "gemini-3.1-pro-preview",
        "Neuestes Pro-Modell für tiefes Schlussfolgern. Vorschau.",
        seit=2,
    ),
    DefaultModel(
        "Gemini 3.7 Flash",
        "google",
        "gemini-3.7-flash",
        "Vorige Flash-Generation für komplexes Coding.",
        seit=2,
    ),
    DefaultModel(
        "Gemini 3.5 Flash-Lite",
        "google",
        "gemini-3.5-flash-lite",
        "Niedrige Latenz, niedrige Kosten.",
        seit=2,
    ),
)

DEFAULTS: tuple[DefaultModel, ...] = CLAUDE + CODEX + GEMINI


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
    for modell in CLAUDE + CLAUDE_LEGACY:
        if kern == modell.api_id:
            return modell.api_id
    # Alias-Weg — nur über die aktuellen Modelle: `opus` heißt das neueste Opus: der letzte Namensteil der Kennung ist der CLI-Alias.
    for modell in CLAUDE:
        alias = modell.api_id.replace("claude-", "").split("-")[0]
        if kern == alias:
            return modell.api_id
    return None
