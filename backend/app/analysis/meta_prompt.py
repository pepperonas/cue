"""Die EINE Definition, wie ein Projekt analysiert wird.

Gleiche Rolle wie `optimization/meta_prompt.py`: wer die Analyse verändern
will, ändert diese Datei und zählt `ANALYSIS_PROMPT_VERSION` hoch — die Zahl
steht an jedem Ergebnis, damit die Historie sagt, nach welchen Regeln ein
Vorschlag entstanden ist.

⚠️ Das Budget ist gemessen, nicht geraten: das größte reale Projekt hat 20
offene Prompts mit 206 306 Zeichen. Ungekürzt wären das ~52k Token je Lauf —
machbar, aber teuer für eine Frage, die sich aus den ersten Absätzen jedes
Prompts beantworten lässt. Gekürzt wird deshalb nach Budget, und die Kürzung
ist im Text SICHTBAR: ein abgeschnittener Prompt, der wie ein vollständiger
aussieht, führt zu einer Einordnung, die der Prompt gar nicht trägt.
"""
from __future__ import annotations

from dataclasses import dataclass

#: Wird an jedem Ergebnis gespeichert. Hochzählen, wenn sich die Regeln ändern.
ANALYSIS_PROMPT_VERSION = 1

#: Gesamtbudget für die Prompt-Texte (Zeichen, nicht Token — die Umrechnung
#: schwankt je Sprache, die Zeichenzahl ist die messbare Größe).
MAX_TOTAL_CHARS = 120_000
#: Untergrenze je Prompt: darunter bleibt vom Ziel nichts übrig.
MIN_PROMPT_CHARS = 1_500
#: Obergrenze je Prompt: mehr trägt zur Frage „was zuerst" nichts bei.
MAX_PROMPT_CHARS = 12_000
#: Titel erledigter Prompts als Kontext. 60 decken jedes reale Projekt ab
#: (größtes Projekt im Bestand: 111 erledigte) und kosten ~600 Token.
MAX_ERLEDIGTE = 60


@dataclass(frozen=True)
class OffenerPrompt:
    id: int
    titel: str
    body: str
    tags: str = ""
    prioritaet: str = "normal"
    blockiert: bool = False


def budget_je_prompt(anzahl: int) -> int:
    """Wie viele Zeichen jeder Prompt-Text beitragen darf.

    Gleichmäßig geteilt statt „die ersten N vollständig": ein Vorschlag, der
    die letzten fünf Prompts nur als Titel kennt, ordnet sie ratend ein.
    """
    if anzahl <= 0:
        return MAX_PROMPT_CHARS
    anteil = MAX_TOTAL_CHARS // anzahl
    return max(MIN_PROMPT_CHARS, min(MAX_PROMPT_CHARS, anteil))


def kuerze(text: str, grenze: int) -> str:
    """Auf `grenze` kürzen und die Kürzung benennen."""
    text = (text or "").strip()
    if len(text) <= grenze:
        return text
    return text[:grenze].rstrip() + "\n[… gekürzt, der Prompt ist länger]"


def _prompt_block(p: OffenerPrompt, grenze: int) -> str:
    kopf = f"### Prompt {p.id}: {p.titel or '(ohne Titel)'}"
    zeilen = [kopf]
    merkmale = []
    if p.prioritaet and p.prioritaet != "normal":
        merkmale.append(f"Priorität: {p.prioritaet}")
    if p.blockiert:
        merkmale.append("BLOCKIERT (kann derzeit nicht bearbeitet werden)")
    if p.tags:
        merkmale.append(f"Schlagworte: {p.tags}")
    if merkmale:
        zeilen.append(" · ".join(merkmale))
    zeilen.append("")
    zeilen.append(kuerze(p.body, grenze))
    return "\n".join(zeilen)


AUFGABE = """Du bist ein erfahrener Technical Lead und planst die Arbeit an EINEM Projekt.

Du bekommst alle offenen Aufgaben („Prompts") dieses Projekts. Deine Aufgabe:

1. **Reihenfolge** — bringe ALLE offenen Prompts in die Folge, in der sie
   bearbeitet werden sollten. Maßgeblich, in dieser Gewichtung:
   - echte fachliche Abhängigkeiten (B braucht das Ergebnis von A),
   - Fundament vor Ausbau (Datenmodell und Verträge vor Oberfläche),
   - was andere Arbeiten entsperrt, zuerst,
   - Risiko früh (was scheitern kann, soll früh scheitern),
   - bei gleichwertigen Kandidaten das Kleinere zuerst.
2. **Zusammenführen** — nenne Gruppen von Prompts, die dasselbe Ziel verfolgen
   und als EIN Arbeitsschritt sinnvoller sind. Sei zurückhaltend: nur wo die
   Trennung die Arbeit erschwert, nicht bei bloß verwandten Themen.
3. **Redundanz** — nenne Prompts, die überflüssig sind, weil die Arbeit laut
   der Liste der erledigten Aufgaben schon getan ist oder weil ein anderer
   offener Prompt sie vollständig abdeckt.
4. **Phasen** — fasse die Reihenfolge zu 2 bis 6 benannten Abschnitten
   zusammen, die jeweils ein erkennbares Zwischenziel haben.
5. **Abhängigkeiten** — nenne nur ECHTE Voraussetzungen zwischen einzelnen
   Prompts, keine bloße Reihenfolge. Wenige, belastbare Kanten sind besser als
   viele vage."""

REGELN = """Harte Regeln:

- Verwende AUSSCHLIESSLICH die oben genannten Prompt-Nummern. Erfinde keine.
- Jeder offene Prompt kommt in `reihenfolge` genau einmal vor.
- Eine Begründung ist EIN Satz, konkret und auf diesen Prompt bezogen.
  „Wichtig für das Projekt" ist keine Begründung.
- Ein Prompt steht in höchstens einer Zusammenführungs-Gruppe und in höchstens
  einer Phase.
- Schlage eine andere `prioritaet` nur vor, wo sie wirklich falsch gesetzt ist
  (erlaubt: "low", "normal", "high"). Lässt du das Feld weg, bleibt sie, wie
  sie ist — das ist der Normalfall.
- Abhängigkeiten müssen zur Reihenfolge passen: `von` steht vor `nach`.
- Antworte mit NICHTS als dem JSON-Objekt. Kein Vorwort, kein Nachwort,
  keine Code-Zäune."""

SCHEMA = """{
  "zusammenfassung": "2-3 Sätze: worauf läuft dieses Projekt als Nächstes hinaus",
  "reihenfolge": [
    {"prompt_id": 12, "begruendung": "ein Satz", "prioritaet": "high"}
  ],
  "phasen": [
    {"name": "Fundament", "ziel": "ein Satz", "prompt_ids": [12, 3]}
  ],
  "abhaengigkeiten": [
    {"von": 12, "nach": 3, "grund": "ein Satz"}
  ],
  "zusammenfuehren": [
    {"prompt_ids": [4, 9], "titel": "Vorschlag für den gemeinsamen Titel",
     "begruendung": "ein Satz"}
  ],
  "redundant": [
    {"prompt_id": 7, "grund": "ein Satz", "abgedeckt_von": 4}
  ]
}"""


def _erledigt_kopf(anzahl: int) -> str:
    if anzahl <= MAX_ERLEDIGTE:
        return f"## Bereits erledigt in diesem Projekt ({anzahl}, nur Titel)"
    return (
        f"## Bereits erledigt in diesem Projekt (die {MAX_ERLEDIGTE} jüngsten "
        f"von {anzahl}, nur Titel)"
    )


def build_analysis_prompt(
    *,
    projekt: str,
    offene: list[OffenerPrompt],
    erledigte_titel: list[str] | None = None,
) -> str:
    """Der vollständige Prompt für einen Analyse-Lauf."""
    grenze = budget_je_prompt(len(offene))
    teile = [
        AUFGABE,
        "",
        f"## Projekt: {projekt}",
        "",
        f"## Offene Prompts ({len(offene)})",
        "",
    ]
    teile.extend(_prompt_block(p, grenze) for p in offene)

    erledigt = [t.strip() for t in (erledigte_titel or []) if t and t.strip()]
    if erledigt:
        # Nur Titel: daraus erkennt das Modell „das ist schon gebaut", ohne
        # dass die erledigte Arbeit das Budget der offenen auffrisst.
        teile += [
            "",
            _erledigt_kopf(len(erledigt)),
            "",
            "Diese Arbeit ist getan. Plane sie nicht erneut ein — nutze sie, um",
            "Redundanzen unter den offenen Prompts zu erkennen.",
            "",
        ]
        teile.extend(f"- {t}" for t in erledigt[:MAX_ERLEDIGTE])

    teile += ["", "## Antwortformat", "", SCHEMA, "", REGELN]
    return "\n".join(teile)
