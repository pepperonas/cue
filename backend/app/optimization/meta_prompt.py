"""The meta prompt — the single place that defines HOW a prompt is improved.

Kept as a versioned constant: every stored optimization records the
`META_PROMPT_VERSION` it was produced with, so a later wording change stays
traceable in the history instead of silently reinterpreting old results.
"""
from __future__ import annotations

# Bump whenever the wording below changes materially.
META_PROMPT_VERSION = 1

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

_ORIGINAL_HEADER = "Zu optimierender Prompt:"

_REFINE_HEADER = """Dies ist eine erneute Optimierung. Du bekommst das Original und die bisher
beste Fassung. Verbessere die bisherige Fassung weiter, ohne die Intention des
Originals zu verlassen. Ist die bisherige Fassung bereits optimal, gib sie
unverändert zurück."""


def build_meta_prompt(original: str, previous: str | None = None) -> str:
    """Assemble the full CLI prompt for one optimization attempt.

    `previous` is the last successful optimization: passing it turns the run
    into a refinement (requirement: a repeat optimization sees BOTH texts).
    """
    if previous:
        return (
            f"{_INSTRUCTIONS}\n\n{_REFINE_HEADER}\n\n"
            f"--- ORIGINAL ---\n{original}\n\n"
            f"--- BISHERIGE OPTIMIERUNG (Version wird fortgeschrieben) ---\n{previous}\n"
            f"--- ENDE ---\n"
        )
    return f"{_INSTRUCTIONS}\n\n{_ORIGINAL_HEADER}\n\n--- PROMPT ---\n{original}\n--- ENDE ---\n"


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
