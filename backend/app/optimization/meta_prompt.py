"""The meta prompt — the single place that defines HOW a prompt is improved.

Kept as a versioned constant: every stored optimization records the
`META_PROMPT_VERSION` it was produced with, so a later wording change stays
traceable in the history instead of silently reinterpreting old results.
"""
from __future__ import annotations

# Bump whenever the wording below changes materially.
META_PROMPT_VERSION = 3

_INSTRUCTIONS = """Du bist ein erfahrener Prompt Engineer. Verbessere den unten stehenden Prompt.

Ziele:
- höhere Genauigkeit
- weniger Halluzinationen
- bessere Struktur
- klare Rollenbeschreibung
- bessere Ausgabeformate
- bessere Schrittfolge
- keine unnötigen Wiederholungen
- maximale Qualität

Regeln:
- Verändere die eigentliche Intention niemals.
- Behalte die Sprache des Originals bei.
- Erfinde keine Anforderungen dazu, die nicht im Original stehen oder sich zwingend aus ihm ergeben.
- Behalte Codeblöcke, Pfade, Befehle und Eigennamen unverändert bei.
- Antworte ausschließlich mit dem optimierten Prompt — ohne Vorrede, ohne Erklärung,
  ohne umschließende Code-Fences und ohne Kommentare zu deinen Änderungen."""

# Bookmarked prompts are the reusable shelf, so they get a different GOAL, not
# an extra paragraph: this block deliberately contradicts the rule above about
# keeping paths and proper nouns — here they are exactly what has to go.
_UNIVERSAL_INSTRUCTIONS = """Du bist ein erfahrener Prompt Engineer. Schreibe den unten stehenden Prompt so um,
dass er UNIVERSELL einsetzbar ist — in jedem Projekt, unabhängig von Technologie,
Verzeichnisstruktur und Eigennamen.

Ziele:
- gleiche Absicht, aber gelöst vom ursprünglichen Projekt
- projektspezifische Angaben werden zu sprechenden Platzhaltern in spitzen Klammern,
  z. B. <Projektname>, <Pfad-zum-Modul>, <Framework>, <Zielumgebung>
- Formulierungen, die nur in einem bestimmten Stack gelten, werden auf das dahinter
  liegende Ziel zurückgeführt
- klare Rollenbeschreibung, saubere Struktur, präzises Ausgabeformat
- sofort benutzbar: der Leser muss nur noch die Platzhalter ersetzen

Regeln:
- Verändere die eigentliche Aufgabe niemals — nur ihren Geltungsbereich.
- Behalte die Sprache des Originals bei.
- Erfinde keine Anforderungen dazu, die nicht im Original stehen.
- Entscheidend ist NICHT „konkret oder allgemein", sondern: ändert sich der Wert von
  Projekt zu Projekt?
  · Projektgebunden → Platzhalter: Pfade, Datei-, Modul-, Repository- und
    Projektnamen, Framework, Programmiersprache, Zielumgebung, Ports.
  · Gehört dem Autor und ist überall gleich → UNVERÄNDERT übernehmen: seine eigenen
    URLs, Profile und Konten, Kontaktdaten, sein Marken-, Firmen- und Produktname,
    Lizenz- und Copyright-Zeilen, feste Gestaltungs- und Stilvorgaben.
- Im Zweifel behalte den Wert. Ein überflüssiger Platzhalter erzwingt bei jeder
  Nutzung eine Eingabe, die sich nie ändert — das ist schlimmer als ein
  stehengebliebenes Detail.
- Codeblöcke und Befehle bleiben erhalten, verlieren aber projektgebundene
  Bezeichner, wo das ohne Sinnverlust möglich ist.
- Verallgemeinere nicht ins Nichtssagende: der Prompt muss konkret genug bleiben,
  um ohne Rückfragen ausführbar zu sein.
- Antworte ausschließlich mit dem optimierten Prompt — ohne Vorrede, ohne Erklärung,
  ohne umschließende Code-Fences und ohne Kommentare zu deinen Änderungen."""

_ORIGINAL_HEADER = "Zu optimierender Prompt:"

_REFINE_HEADER = """Dies ist eine erneute Optimierung. Du bekommst das Original und die bisher
beste Fassung. Verbessere die bisherige Fassung weiter, ohne die Intention des
Originals zu verlassen. Ist die bisherige Fassung bereits optimal, gib sie
unverändert zurück."""


def build_meta_prompt(
    original: str, previous: str | None = None, *, universal: bool = False
) -> str:
    """Assemble the full CLI prompt for one optimization attempt.

    `previous` is the last successful optimization: passing it turns the run
    into a refinement (requirement: a repeat optimization sees BOTH texts).

    `universal` switches the GOAL from "sharpen this prompt" to "make this
    prompt work in any project" — that is what a bookmark is for. The two
    instruction sets are alternatives, never combined: one keeps paths and
    proper nouns verbatim, the other exists to replace them.
    """
    instructions = _UNIVERSAL_INSTRUCTIONS if universal else _INSTRUCTIONS
    if previous:
        return (
            f"{instructions}\n\n{_REFINE_HEADER}\n\n"
            f"--- ORIGINAL ---\n{original}\n\n"
            f"--- BISHERIGE OPTIMIERUNG (Version wird fortgeschrieben) ---\n{previous}\n"
            f"--- ENDE ---\n"
        )
    return f"{instructions}\n\n{_ORIGINAL_HEADER}\n\n--- PROMPT ---\n{original}\n--- ENDE ---\n"


def clean_result(text: str) -> str:
    """Strip the wrappers models add despite being told not to.

    Removes a single enclosing code fence (``` or ```markdown) and surrounding
    whitespace. Fences INSIDE the prompt are left untouched — only a fence that
    opens on the first line and closes on the last one is treated as packaging.
    """
    cleaned = (text or "").strip()
    if not cleaned.startswith("```"):
        return cleaned
    lines = cleaned.splitlines()
    if len(lines) < 2 or not lines[-1].rstrip().startswith("```"):
        return cleaned
    return "\n".join(lines[1:-1]).strip()
