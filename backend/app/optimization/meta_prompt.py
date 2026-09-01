"""The meta prompt — the single place that defines HOW a prompt is improved.

Kept as a versioned constant: every stored optimization records the
`META_PROMPT_VERSION` it was produced with, so a later wording change stays
traceable in the history instead of silently reinterpreting old results.
"""
from __future__ import annotations

from dataclasses import dataclass

# Bump whenever the wording below changes materially.
META_PROMPT_VERSION = 4

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
%(format)s"""

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
- Auch der Titel wird vom Projekt gelöst: er benennt die Aufgabe, nicht das Repository.
%(format)s"""

#: Marken des Ausgabeformats. Bewusst dieselbe Form wie die Eingabe-Marken —
#: das Modell sieht sie im selben Text und ahmt sie zuverlässiger nach als ein
#: fremdes Schema.
T_MARK = "--- TITEL ---"
G_MARK = "--- TAGS ---"
P_MARK = "--- PROMPT ---"
E_MARK = "--- ENDE ---"

#: Höchstlänge eines vorgeschlagenen Titels. Der Titel steht auf einer Karte,
#: ein Absatz an dieser Stelle wäre kein Titel mehr.
MAX_TITLE_CHARS = 90
#: Mehr als das sind keine Schlagworte mehr, sondern eine Zusammenfassung.
MAX_TAGS = 4

_FORMAT = f"""
Antworte in GENAU diesem Format, ohne Vorrede, ohne Erklärung, ohne
umschließende Code-Fences und ohne Kommentare zu deinen Änderungen:

{T_MARK}
<Titel in einer Zeile, höchstens {MAX_TITLE_CHARS} Zeichen>
{G_MARK}
<höchstens {MAX_TAGS} Schlagworte, kommagetrennt, klein geschrieben, je ein Wort>
{P_MARK}
<der optimierte Prompt>
{E_MARK}

Zu Titel und Schlagworten:
- Der Titel beschreibt die Aufgabe des ÜBERARBEITETEN Prompts. Passt der
  bisherige weiterhin, gib ihn unverändert zurück.
- Schlagworte benennen die Art der Arbeit, nicht ihren Gegenstand.
- Nutze bevorzugt bereits vorhandene Schlagworte (Liste unten). Erfinde nur
  eines, wenn wirklich keines passt — zwei Wörter für dieselbe Sache sind
  schlimmer als ein fehlendes.
- Sind Titel und Schlagworte bereits treffend, ändere sie nicht."""

_ORIGINAL_HEADER = "Zu optimierender Prompt:"

_REFINE_HEADER = """Dies ist eine erneute Optimierung. Du bekommst das Original und die bisher
beste Fassung. Verbessere die bisherige Fassung weiter, ohne die Intention des
Originals zu verlassen. Ist die bisherige Fassung bereits optimal, gib sie
unverändert zurück."""


def build_meta_prompt(
    original: str,
    previous: str | None = None,
    *,
    universal: bool = False,
    title: str = "",
    tags: str = "",
    vocabulary: list[str] | None = None,
) -> str:
    """Assemble the full CLI prompt for one optimization attempt.

    `previous` is the last successful optimization: passing it turns the run
    into a refinement (requirement: a repeat optimization sees BOTH texts).

    `universal` switches the GOAL from "sharpen this prompt" to "make this
    prompt work in any project" — that is what a bookmark is for. The two
    instruction sets are alternatives, never combined: one keeps paths and
    proper nouns verbatim, the other exists to replace them.

    `title`/`tags` are the prompt's current ones, `vocabulary` the tags this
    account already uses. The vocabulary is what keeps the tag list from
    growing synonyms: a model with no idea what is in use invents `bug-fixing`
    next to the `bugfix` that has been there all along.
    """
    body = _UNIVERSAL_INSTRUCTIONS if universal else _INSTRUCTIONS
    instructions = body % {"format": _FORMAT}
    context = _context(title, tags, vocabulary)
    if previous:
        return (
            f"{instructions}\n{context}\n{_REFINE_HEADER}\n\n"
            f"--- ORIGINAL ---\n{original}\n\n"
            f"--- BISHERIGE OPTIMIERUNG (Version wird fortgeschrieben) ---\n{previous}\n"
            f"{E_MARK}\n"
        )
    return (
        f"{instructions}\n{context}\n{_ORIGINAL_HEADER}\n\n"
        f"{P_MARK}\n{original}\n{E_MARK}\n"
    )


def _context(title: str, tags: str, vocabulary: list[str] | None) -> str:
    """Current title, current tags and the account's vocabulary.

    Left out entirely when there is nothing to say — an empty "Bisheriger
    Titel:" line is an invitation to invent one.
    """
    lines = []
    if title.strip():
        lines.append(f"Bisheriger Titel: {title.strip()}")
    if tags.strip():
        lines.append(f"Bisherige Schlagworte: {tags.strip()}")
    if vocabulary:
        lines.append("Bereits verwendete Schlagworte: " + ", ".join(vocabulary))
    return "\n" + "\n".join(lines) + "\n" if lines else ""


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


@dataclass(frozen=True)
class Parsed:
    """What one answer contained. `title`/`tags` are None when not proposed."""

    body: str
    title: str | None = None
    tags: str | None = None


def parse_result(text: str) -> Parsed:
    """Split an answer into body, title and tags.

    ⚠️ **The body must survive every shape of answer.** A model that ignores
    the format and simply returns the rewritten prompt — which is what every
    answer looked like before v4, and what a weaker model still does — has
    produced a perfectly good optimization; refusing it because a marker is
    missing would throw away a paid call over packaging. So: no `--- PROMPT ---`
    marker means the whole text IS the body, and nothing is proposed for title
    or tags. Everything below that is a bonus, never a condition.

    Title and tags are clamped here rather than trusted: `MAX_TITLE_CHARS` and
    `MAX_TAGS` are asked for in the instructions, and asking is not enforcing.
    """
    cleaned = clean_result(text)
    if P_MARK not in cleaned:
        return Parsed(body=cleaned)

    head, _, rest = cleaned.partition(P_MARK)
    body = rest
    # A trailing end marker is packaging, not content — but only at the very
    # end: `--- ENDE ---` inside a prompt is the user's own text.
    end = body.rstrip()
    if end.endswith(E_MARK):
        body = end[: -len(E_MARK)]
    return Parsed(body=body.strip(), title=_title_from(head), tags=_tags_from(head))


def _section(head: str, mark: str) -> str:
    """The text after `mark`, up to the next marker."""
    if mark not in head:
        return ""
    after = head.split(mark, 1)[1]
    for other in (T_MARK, G_MARK, P_MARK, E_MARK):
        after = after.split(other, 1)[0]
    return after.strip()


def _title_from(head: str) -> str | None:
    raw = _section(head, T_MARK)
    if not raw:
        return None
    # Only the first line: a model that writes a paragraph here has answered the
    # wrong question, and the first line is still the best guess at a title.
    line = raw.splitlines()[0].strip()
    # Models like to decorate: a leading heading marker, surrounding quotes.
    line = line.lstrip("#").strip().strip('"').strip("'").strip()
    if not line:
        return None
    return line[:MAX_TITLE_CHARS].strip()


def _tags_from(head: str) -> str | None:
    raw = _section(head, G_MARK)
    if not raw:
        return None
    names: list[str] = []
    seen: set[str] = set()
    for part in raw.replace("\n", ",").split(","):
        name = part.strip().strip("#").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= MAX_TAGS:
            break
    return ", ".join(names) if names else None
