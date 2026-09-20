"""Der Vertrag zwischen der KI-Antwort und allem, was cue damit tut.

Das Risiko dieses Features ist nicht die Datenbank und nicht die Oberfläche,
sondern **der Text, den ein Sprachmodell zurückgibt**. Er kann in ```json
gehüllt sein, Prosa davorstellen, IDs erfinden, einen Prompt vergessen oder
Abhängigkeiten behaupten, die sich im Kreis drehen. Deshalb liegt die gesamte
Auswertung hier: pur, ohne Datenbank, ohne FastAPI, vollständig testbar.

Drei Zusicherungen, die das Modul durchhält — sie sind der Grund, dass ein
schlechter Lauf höchstens einen schwachen Vorschlag erzeugt und nie einen
kaputten Zustand:

1. **Kein Prompt verschwindet.** Was die KI in der Reihenfolge vergisst, hängt
   hinten an, in seiner bisherigen Position. Ein Vorschlag, der die Hälfte der
   Queue unterschlägt, wäre schlimmer als gar keiner.
2. **Unbekanntes wird verworfen, nicht gemeldet.** Eine erfundene Prompt-ID ist
   kein Grund, einen bezahlten Lauf wegzuwerfen — sie fliegt raus, und der
   Hinweis steht im Ergebnis (dieselbe Regel wie `ir_format`: Fehler je Zeile
   sammeln, nie fatal).
3. **Widersprüche werden aufgelöst, nicht gerendert.** Die Reihenfolge ist die
   primäre Aussage; eine Abhängigkeit, die ihr widerspricht oder einen Zyklus
   schließt, wird entfernt. Ein Zyklus macht den Graphen unzeichenbar und die
   Reihenfolge bedeutungslos.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

#: Erlaubte Prioritäten — identisch zu `models.PromptPriority`, hier als reine
#: Zeichenketten, damit dieses Modul nichts aus der Datenbankschicht importiert.
PRIORITAETEN = ("low", "normal", "high")

#: Obergrenzen. Die KI wird gebeten, sich daran zu halten; erzwungen wird es
#: hier, denn „bitte höchstens vier" ist keine Durchsetzung.
MAX_BEGRUENDUNG = 400
MAX_TITEL = 120
MAX_ZUSAMMENFASSUNG = 1200
MAX_PHASEN = 12
MAX_BUENDEL = 20
MAX_KANTEN = 120


@dataclass(frozen=True)
class Schritt:
    """Ein Prompt an seiner vorgeschlagenen Stelle."""

    prompt_id: int
    rang: int
    begruendung: str = ""
    #: None = Priorität unverändert lassen. Nur gesetzt, wenn die KI eine
    #: ANDERE als die aktuelle vorschlägt — ein Vorschlag, der nichts ändert,
    #: ist kein Vorschlag und würde die Übernahme-Ansicht mit Rauschen füllen.
    prioritaet: str | None = None
    #: True, wenn die KI diesen Prompt gar nicht genannt hat und er nur
    #: angehängt wurde. Die Oberfläche kennzeichnet das.
    ergaenzt: bool = False


@dataclass(frozen=True)
class Buendel:
    """Prompts, die dasselbe Ziel verfolgen und zusammengeführt werden können."""

    prompt_ids: tuple[int, ...]
    titel: str = ""
    begruendung: str = ""


@dataclass(frozen=True)
class Redundanz:
    """Ein Prompt, der bereits erledigt oder von einem anderen abgedeckt ist."""

    prompt_id: int
    grund: str = ""
    #: Der Prompt, der ihn abdeckt — oder None, wenn die Arbeit schon erledigt ist.
    abgedeckt_von: int | None = None


@dataclass(frozen=True)
class Phase:
    """Ein Abschnitt des Ablaufs, für die Grafik und die Gliederung."""

    name: str
    prompt_ids: tuple[int, ...]
    ziel: str = ""


@dataclass(frozen=True)
class Kante:
    """`von` muss vor `nach` erledigt sein."""

    von: int
    nach: int
    grund: str = ""


@dataclass(frozen=True)
class Analyse:
    reihenfolge: tuple[Schritt, ...] = ()
    buendel: tuple[Buendel, ...] = ()
    redundanzen: tuple[Redundanz, ...] = ()
    phasen: tuple[Phase, ...] = ()
    kanten: tuple[Kante, ...] = ()
    zusammenfassung: str = ""
    #: Was verworfen wurde und warum. Gehört ins Ergebnis, nicht ins Log: wer
    #: den Vorschlag liest, soll sehen, dass etwas fehlt.
    hinweise: tuple[str, ...] = field(default_factory=tuple)

    def leer(self) -> bool:
        return not (self.reihenfolge or self.buendel or self.redundanzen)


class AnalyseFehler(ValueError):
    """Die Antwort war so kaputt, dass nichts daraus zu retten ist."""


# ---------------------------------------------------------------------------
# JSON aus einer Antwort schälen


def extrahiere_json(text: str) -> dict:
    """Das erste JSON-Objekt aus einer Modellantwort.

    Modelle stellen gern einen Satz voran oder hüllen die Antwort in einen
    ```json-Block. Beides ist hier zu erwarten und kein Fehler.

    ⚠️ Geklammert wird mit einem echten Scanner, nicht mit `text.rfind("}")`:
    ein Begründungstext, der eine geschweifte Klammer enthält (Code-Beispiele
    sind in dieser App der Normalfall), würde sonst die Grenze verschieben.
    """
    if not text or not text.strip():
        raise AnalyseFehler("Die Antwort war leer")
    roh = text.strip()
    # Der einfache Fall zuerst: die Antwort IST das Objekt.
    try:
        gelesen = json.loads(roh)
        if isinstance(gelesen, dict):
            return gelesen
    except json.JSONDecodeError:
        pass
    ausschnitt = _erstes_objekt(roh)
    if ausschnitt is None:
        raise AnalyseFehler("Die Antwort enthielt kein JSON-Objekt")
    try:
        gelesen = json.loads(ausschnitt)
    except json.JSONDecodeError as exc:
        raise AnalyseFehler(f"Das JSON der Antwort ist ungültig: {exc.msg}") from exc
    if not isinstance(gelesen, dict):
        raise AnalyseFehler("Die Antwort war kein JSON-Objekt")
    return gelesen


def _erstes_objekt(text: str) -> str | None:
    """Vom ersten `{` bis zur zugehörigen `}`, Zeichenketten respektierend."""
    start = text.find("{")
    if start < 0:
        return None
    tiefe = 0
    in_text = False
    maskiert = False
    for i in range(start, len(text)):
        zeichen = text[i]
        if in_text:
            if maskiert:
                maskiert = False
            elif zeichen == "\\":
                maskiert = True
            elif zeichen == '"':
                in_text = False
            continue
        if zeichen == '"':
            in_text = True
        elif zeichen == "{":
            tiefe += 1
        elif zeichen == "}":
            tiefe -= 1
            if tiefe == 0:
                return text[start : i + 1]
    return None


# ---------------------------------------------------------------------------
# Normalisieren


def _text(wert, grenze: int) -> str:  # noqa: ANN001
    if not isinstance(wert, str):
        return ""
    return " ".join(wert.split())[:grenze]


def _id(wert) -> int | None:  # noqa: ANN001
    """Eine Prompt-ID, auch wenn sie als "12" oder 12.0 ankommt."""
    if isinstance(wert, bool):  # bool ist ein int — hier nie gemeint
        return None
    if isinstance(wert, int):
        return wert
    if isinstance(wert, float) and wert.is_integer():
        return int(wert)
    if isinstance(wert, str) and wert.strip().lstrip("-").isdigit():
        return int(wert.strip())
    return None


def _liste(roh: dict, *namen: str) -> list:
    """Die erste vorhandene Liste unter mehreren erlaubten Schlüsseln."""
    for name in namen:
        wert = roh.get(name)
        if isinstance(wert, list):
            return wert
    return []


def normalisiere(
    roh: dict,
    *,
    bekannt: dict[int, str],
    aktuelle_prioritaet: dict[int, str] | None = None,
) -> Analyse:
    """Rohe Modellausgabe → geprüfter Vorschlag.

    `bekannt` bildet die IDs ab, die wirklich mitgeschickt wurden, auf ihre
    Titel — daran wird alles gemessen. Die Reihenfolge von `bekannt` ist die
    aktuelle Board-Reihenfolge und damit die Rückfallposition für alles, was
    die KI nicht genannt hat.
    """
    hinweise: list[str] = []
    prioritaeten = aktuelle_prioritaet or {}

    reihenfolge = _reihenfolge(roh, bekannt, prioritaeten, hinweise)
    buendel = _buendel(roh, bekannt, hinweise)
    gebuendelt = {pid for b in buendel for pid in b.prompt_ids}
    redundanzen = _redundanzen(roh, bekannt, gebuendelt, hinweise)
    phasen = _phasen(roh, bekannt, reihenfolge, hinweise)
    kanten = _kanten(roh, bekannt, reihenfolge, hinweise)

    return Analyse(
        reihenfolge=reihenfolge,
        buendel=buendel,
        redundanzen=redundanzen,
        phasen=phasen,
        kanten=kanten,
        zusammenfassung=_text(roh.get("zusammenfassung"), MAX_ZUSAMMENFASSUNG),
        hinweise=tuple(hinweise),
    )


def _reihenfolge(
    roh: dict,
    bekannt: dict[int, str],
    prioritaeten: dict[int, str],
    hinweise: list[str],
) -> tuple[Schritt, ...]:
    schritte: list[Schritt] = []
    gesehen: set[int] = set()
    unbekannt = 0
    for eintrag in _liste(roh, "reihenfolge", "order"):
        if not isinstance(eintrag, dict):
            continue
        pid = _id(eintrag.get("prompt_id"))
        if pid is None or pid not in bekannt:
            unbekannt += 1
            continue
        if pid in gesehen:  # Doppelte: der erste Platz gilt.
            continue
        gesehen.add(pid)
        vorschlag = eintrag.get("prioritaet") or eintrag.get("priority")
        prio = vorschlag if vorschlag in PRIORITAETEN else None
        # Ein Vorschlag, der die aktuelle Priorität bestätigt, ist keiner.
        if prio is not None and prio == prioritaeten.get(pid):
            prio = None
        schritte.append(
            Schritt(
                prompt_id=pid,
                rang=len(schritte) + 1,
                begruendung=_text(
                    eintrag.get("begruendung") or eintrag.get("reason"), MAX_BEGRUENDUNG
                ),
                prioritaet=prio,
            )
        )
    if unbekannt:
        hinweise.append(f"{unbekannt} unbekannte Prompt-Verweise in der Reihenfolge verworfen")

    # Zusicherung 1: nichts verschwindet. Vergessene Prompts hängen in ihrer
    # bisherigen Board-Reihenfolge hinten an.
    fehlend = [pid for pid in bekannt if pid not in gesehen]
    for pid in fehlend:
        schritte.append(
            Schritt(prompt_id=pid, rang=len(schritte) + 1, begruendung="", ergaenzt=True)
        )
    if fehlend:
        hinweise.append(
            f"{len(fehlend)} Prompts wurden nicht eingeordnet und hängen unverändert hinten an"
        )
    return tuple(schritte)


def _buendel(roh: dict, bekannt: dict[int, str], hinweise: list[str]) -> tuple[Buendel, ...]:
    gefunden: list[Buendel] = []
    vergeben: set[int] = set()
    for eintrag in _liste(roh, "zusammenfuehren", "merge")[:MAX_BUENDEL]:
        if not isinstance(eintrag, dict):
            continue
        ids: list[int] = []
        for wert in eintrag.get("prompt_ids") or []:
            pid = _id(wert)
            # ⚠️ Ein Prompt darf in HÖCHSTENS einem Bündel stehen: zwei
            # Zusammenführungen, die denselben Prompt beanspruchen, lassen sich
            # nicht beide ausführen — die zweite fände ihn nicht mehr vor.
            if pid is not None and pid in bekannt and pid not in ids and pid not in vergeben:
                ids.append(pid)
        if len(ids) < 2:
            continue
        vergeben.update(ids)
        gefunden.append(
            Buendel(
                prompt_ids=tuple(ids),
                titel=_text(eintrag.get("titel") or eintrag.get("title"), MAX_TITEL),
                begruendung=_text(
                    eintrag.get("begruendung") or eintrag.get("reason"), MAX_BEGRUENDUNG
                ),
            )
        )
    return tuple(gefunden)


def _redundanzen(
    roh: dict,
    bekannt: dict[int, str],
    gebuendelt: set[int],
    hinweise: list[str],
) -> tuple[Redundanz, ...]:
    gefunden: list[Redundanz] = []
    gesehen: set[int] = set()
    kollision = 0
    for eintrag in _liste(roh, "redundant", "redundanzen"):
        if not isinstance(eintrag, dict):
            continue
        pid = _id(eintrag.get("prompt_id"))
        if pid is None or pid not in bekannt or pid in gesehen:
            continue
        # ⚠️ Zusammenführen schlägt Archivieren: die KI hat sich widersprochen,
        # und von zwei Aussagen ist die verlustfreie die richtige. Archivieren
        # nähme den Text aus der Queue, den das Bündel gerade behalten will.
        if pid in gebuendelt:
            kollision += 1
            continue
        deckung = _id(eintrag.get("abgedeckt_von") or eintrag.get("covered_by"))
        if deckung is not None and (deckung not in bekannt or deckung == pid):
            deckung = None
        gesehen.add(pid)
        gefunden.append(
            Redundanz(
                prompt_id=pid,
                grund=_text(eintrag.get("grund") or eintrag.get("reason"), MAX_BEGRUENDUNG),
                abgedeckt_von=deckung,
            )
        )
    if kollision:
        hinweise.append(
            f"{kollision} Prompts galten zugleich als redundant und als Zusammenführung — "
            "die Zusammenführung gilt"
        )
    return tuple(gefunden)


def _phasen(
    roh: dict,
    bekannt: dict[int, str],
    reihenfolge: tuple[Schritt, ...],
    hinweise: list[str],
) -> tuple[Phase, ...]:
    gefunden: list[Phase] = []
    vergeben: set[int] = set()
    for eintrag in _liste(roh, "phasen", "phases")[:MAX_PHASEN]:
        if not isinstance(eintrag, dict):
            continue
        ids = []
        for wert in eintrag.get("prompt_ids") or []:
            pid = _id(wert)
            # Ein Prompt gehört in GENAU eine Phase — sonst stünde dieselbe
            # Karte zweimal im Ablaufplan und die Grafik verdoppelte Arbeit.
            if pid is not None and pid in bekannt and pid not in vergeben:
                ids.append(pid)
                vergeben.add(pid)
        name = _text(eintrag.get("name"), MAX_TITEL)
        if not ids or not name:
            continue
        gefunden.append(
            Phase(name=name, prompt_ids=tuple(ids), ziel=_text(eintrag.get("ziel"), MAX_BEGRUENDUNG))
        )
    if not gefunden:
        return ()
    # Auch hier: nichts verschwindet. Was in keiner Phase steht, bekommt eine
    # eigene — eine Grafik, die die Hälfte der Queue unterschlägt, ist falsch.
    rest = [s.prompt_id for s in reihenfolge if s.prompt_id not in vergeben]
    if rest:
        gefunden.append(Phase(name="Ohne Phase", prompt_ids=tuple(rest), ziel=""))
        hinweise.append(f"{len(rest)} Prompts wurden keiner Phase zugeordnet")
    return tuple(gefunden)


def _kanten(
    roh: dict,
    bekannt: dict[int, str],
    reihenfolge: tuple[Schritt, ...],
    hinweise: list[str],
) -> tuple[Kante, ...]:
    rang = {s.prompt_id: s.rang for s in reihenfolge}
    gefunden: list[Kante] = []
    widerspruch = 0
    for eintrag in _liste(roh, "abhaengigkeiten", "dependencies")[:MAX_KANTEN]:
        if not isinstance(eintrag, dict):
            continue
        von = _id(eintrag.get("von") or eintrag.get("from"))
        nach = _id(eintrag.get("nach") or eintrag.get("to"))
        if von is None or nach is None or von == nach:
            continue
        if von not in bekannt or nach not in bekannt:
            continue
        # Zusicherung 3a: die Reihenfolge ist die primäre Aussage. Eine Kante,
        # die ihr widerspricht, ist ein Selbstwiderspruch der Antwort.
        if rang.get(von, 0) > rang.get(nach, 0):
            widerspruch += 1
            continue
        # Zusicherung 3b (Azyklizität) braucht KEINE eigene Prüfung: die
        # Ränge sind eine strikte Totalordnung (1..n, lückenlos vergeben), und
        # die Zeile darüber lässt nur Kanten durch, die in dieser Ordnung
        # vorwärts laufen. Ein Kreis bräuchte eine Rückwärtskante, die es hier
        # nicht mehr gibt. Eine zusätzliche Erreichbarkeitsprüfung wäre ein
        # Wächter, der nie anschlägt — ein solcher liest sich wie eine Regel
        # und ist keine. Die Eigenschaft ist stattdessen als Test gepinnt
        # (`test_the_result_can_never_contain_a_cycle`).
        gefunden.append(
            Kante(
                von=von,
                nach=nach,
                grund=_text(eintrag.get("grund") or eintrag.get("reason"), MAX_BEGRUENDUNG),
            )
        )
    if widerspruch:
        hinweise.append(
            f"{widerspruch} Abhängigkeiten widersprachen der vorgeschlagenen Reihenfolge"
        )
    return tuple(gefunden)


# ---------------------------------------------------------------------------
# Serialisieren (Speicherung + Auslieferung)


def als_dict(analyse: Analyse) -> dict:
    return {
        "reihenfolge": [
            {
                "prompt_id": s.prompt_id,
                "rang": s.rang,
                "begruendung": s.begruendung,
                "prioritaet": s.prioritaet,
                "ergaenzt": s.ergaenzt,
            }
            for s in analyse.reihenfolge
        ],
        "zusammenfuehren": [
            {"prompt_ids": list(b.prompt_ids), "titel": b.titel, "begruendung": b.begruendung}
            for b in analyse.buendel
        ],
        "redundant": [
            {"prompt_id": r.prompt_id, "grund": r.grund, "abgedeckt_von": r.abgedeckt_von}
            for r in analyse.redundanzen
        ],
        "phasen": [
            {"name": p.name, "prompt_ids": list(p.prompt_ids), "ziel": p.ziel}
            for p in analyse.phasen
        ],
        "abhaengigkeiten": [
            {"von": k.von, "nach": k.nach, "grund": k.grund} for k in analyse.kanten
        ],
        "zusammenfassung": analyse.zusammenfassung,
        "hinweise": list(analyse.hinweise),
    }
