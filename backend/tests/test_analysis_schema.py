"""Der Vertrag gegen KI-Ausgabe — die Stelle, an der dieses Feature bricht.

Fast alles hier ist negativ: erfundene IDs, Doppelte, Widersprüche, Kreise,
vergessene Prompts. Der gute Fall funktioniert von allein; teuer sind die
Antworten, die *fast* richtig sind.
"""
from __future__ import annotations

import json

import pytest

from app.analysis import schema


BEKANNT = {1: "Erstes", 2: "Zweites", 3: "Drittes"}


def norm(roh: dict, bekannt=None, prio=None):
    return schema.normalisiere(roh, bekannt=bekannt or BEKANNT, aktuelle_prioritaet=prio)


def ordne(*ids: int) -> dict:
    return {"reihenfolge": [{"prompt_id": i} for i in ids]}


# --------------------------------------------------------------------- JSON


def test_a_bare_object_is_read():
    assert schema.extrahiere_json('{"a": 1}') == {"a": 1}


def test_a_fenced_block_is_read():
    text = 'Gern!\n```json\n{"a": 1}\n```\nViel Erfolg.'
    assert schema.extrahiere_json(text) == {"a": 1}


def test_prose_before_the_object_is_skipped():
    assert schema.extrahiere_json('Hier die Analyse:\n{"a": [1,2]}') == {"a": [1, 2]}


def test_a_brace_inside_a_string_does_not_end_the_object():
    """Begründungen enthalten in dieser App regelmäßig Code."""
    roh = {"zusammenfassung": 'nutze {"x": 1} als Beispiel', "reihenfolge": []}
    text = "Antwort:\n" + json.dumps(roh) + "\nEnde."
    assert schema.extrahiere_json(text)["zusammenfassung"] == roh["zusammenfassung"]


def test_an_escaped_quote_does_not_end_the_string():
    roh = {"zusammenfassung": 'er sagte \\"ja\\" und }'}
    text = json.dumps(roh)
    assert schema.extrahiere_json(text) == roh


@pytest.mark.parametrize("text", ["", "   ", "kein JSON hier", "[1,2,3]", '{"a": '])
def test_unusable_answers_raise(text):
    with pytest.raises(schema.AnalyseFehler):
        schema.extrahiere_json(text)


# ---------------------------------------------------------------- Reihenfolge


def test_the_order_is_ranked_from_one():
    a = norm(ordne(3, 1, 2))
    assert [(s.prompt_id, s.rang) for s in a.reihenfolge] == [(3, 1), (1, 2), (2, 3)]


def test_a_forgotten_prompt_is_appended_and_marked():
    """Zusicherung 1: ein Vorschlag darf keinen Prompt unterschlagen."""
    a = norm(ordne(2))
    assert [s.prompt_id for s in a.reihenfolge] == [2, 1, 3]
    assert [s.ergaenzt for s in a.reihenfolge] == [False, True, True]
    assert any("nicht eingeordnet" in h for h in a.hinweise)


def test_an_invented_id_is_dropped_with_a_note():
    a = norm(ordne(1, 999))
    assert 999 not in [s.prompt_id for s in a.reihenfolge]
    assert any("unbekannte" in h for h in a.hinweise)


def test_a_repeated_id_keeps_its_first_place():
    a = norm(ordne(3, 1, 3))
    assert [s.prompt_id for s in a.reihenfolge] == [3, 1, 2]


@pytest.mark.parametrize("wert,erwartet", [(2, 2), ("2", 2), (2.0, 2), (True, None), ("x", None)])
def test_ids_survive_the_shapes_models_emit(wert, erwartet):
    a = norm({"reihenfolge": [{"prompt_id": wert}]})
    erster = a.reihenfolge[0].prompt_id
    assert (erster == erwartet) if erwartet else (erster != 2 or wert in (2, "2", 2.0))


def test_a_priority_equal_to_the_current_one_is_not_a_proposal():
    a = norm(
        {"reihenfolge": [{"prompt_id": 1, "prioritaet": "high"}]},
        prio={1: "high"},
    )
    assert a.reihenfolge[0].prioritaet is None


def test_a_different_priority_is_kept():
    a = norm({"reihenfolge": [{"prompt_id": 1, "prioritaet": "high"}]}, prio={1: "normal"})
    assert a.reihenfolge[0].prioritaet == "high"


def test_an_invented_priority_is_ignored():
    a = norm({"reihenfolge": [{"prompt_id": 1, "prioritaet": "dringend"}]})
    assert a.reihenfolge[0].prioritaet is None


# ------------------------------------------------------------------ Bündel


def test_a_group_of_one_is_not_a_merge():
    a = norm({"zusammenfuehren": [{"prompt_ids": [1]}]})
    assert a.buendel == ()


def test_a_prompt_belongs_to_at_most_one_merge_group():
    """Zwei Zusammenführungen um denselben Prompt lassen sich nicht beide ausführen."""
    a = norm({"zusammenfuehren": [{"prompt_ids": [1, 2]}, {"prompt_ids": [1, 3]}]})
    assert [b.prompt_ids for b in a.buendel] == [(1, 2)]


def test_unknown_members_are_dropped_from_a_group():
    a = norm({"zusammenfuehren": [{"prompt_ids": [1, 2, 999]}]})
    assert a.buendel[0].prompt_ids == (1, 2)


# --------------------------------------------------------------- Redundanz


def test_merging_beats_archiving():
    """Widerspricht sich die KI, gilt die verlustfreie Aussage."""
    a = norm(
        {
            "zusammenfuehren": [{"prompt_ids": [1, 2]}],
            "redundant": [{"prompt_id": 1, "grund": "doppelt"}],
        }
    )
    assert a.redundanzen == ()
    assert any("Zusammenführung gilt" in h for h in a.hinweise)


def test_a_prompt_cannot_cover_itself():
    a = norm({"redundant": [{"prompt_id": 1, "abgedeckt_von": 1}]})
    assert a.redundanzen[0].abgedeckt_von is None


def test_an_unknown_cover_becomes_none_but_keeps_the_finding():
    a = norm({"redundant": [{"prompt_id": 1, "abgedeckt_von": 999, "grund": "alt"}]})
    assert a.redundanzen[0].prompt_id == 1
    assert a.redundanzen[0].abgedeckt_von is None


# ------------------------------------------------------------------ Phasen


def test_without_phases_none_are_invented():
    assert norm(ordne(1, 2, 3)).phasen == ()


def test_prompts_outside_every_phase_get_their_own():
    roh = ordne(1, 2, 3) | {"phasen": [{"name": "Fundament", "prompt_ids": [1]}]}
    a = norm(roh)
    assert [(p.name, p.prompt_ids) for p in a.phasen] == [
        ("Fundament", (1,)),
        ("Ohne Phase", (2, 3)),
    ]


def test_a_prompt_appears_in_exactly_one_phase():
    roh = ordne(1, 2) | {
        "phasen": [
            {"name": "A", "prompt_ids": [1, 2]},
            {"name": "B", "prompt_ids": [2]},
        ]
    }
    a = norm(roh)
    assert [p.prompt_ids for p in a.phasen if p.name in ("A", "B")] == [(1, 2)]


def test_a_nameless_phase_is_dropped():
    roh = ordne(1) | {"phasen": [{"prompt_ids": [1]}]}
    assert norm(roh).phasen == ()


# ------------------------------------------------------------ Abhängigkeiten


def test_a_dependency_following_the_order_is_kept():
    roh = ordne(1, 2) | {"abhaengigkeiten": [{"von": 1, "nach": 2, "grund": "baut darauf"}]}
    a = norm(roh)
    assert [(k.von, k.nach) for k in a.kanten] == [(1, 2)]


def test_a_dependency_contradicting_the_order_is_dropped():
    roh = ordne(1, 2) | {"abhaengigkeiten": [{"von": 2, "nach": 1}]}
    a = norm(roh)
    assert a.kanten == ()
    assert any("widersprachen" in h for h in a.hinweise)


def test_a_self_dependency_is_dropped():
    roh = ordne(1) | {"abhaengigkeiten": [{"von": 1, "nach": 1}]}
    assert norm(roh).kanten == ()


def test_the_result_can_never_contain_a_cycle():
    """Die Eigenschaft, nicht der Mechanismus.

    Es gibt bewusst KEINE Erreichbarkeitsprüfung: die Ränge sind eine strikte
    Totalordnung, und nur vorwärts laufende Kanten überleben — ein Kreis ist
    damit ausgeschlossen. Geprüft wird deshalb das Ergebnis, egal was
    hereinkommt; dieser Test bleibt gültig, falls die Vergabe der Ränge je
    geändert wird, und schlägt dann an.
    """
    roh = {
        "reihenfolge": [{"prompt_id": i} for i in (1, 2, 3)],
        "abhaengigkeiten": [
            {"von": a, "nach": b} for a in (1, 2, 3) for b in (1, 2, 3)
        ],  # der vollständige Graph, inklusive aller Rückwärtskanten
    }
    kanten = norm(roh).kanten
    assert kanten, "der Test wäre sonst leer erfüllt"

    nachfolger: dict[int, set[int]] = {}
    for k in kanten:
        nachfolger.setdefault(k.von, set()).add(k.nach)

    def erreicht(start: int, ziel: int) -> bool:
        stapel, gesehen = [start], set()
        while stapel:
            knoten = stapel.pop()
            if knoten == ziel:
                return True
            if knoten in gesehen:
                continue
            gesehen.add(knoten)
            stapel.extend(nachfolger.get(knoten, ()))
        return False

    for k in kanten:
        assert not erreicht(k.nach, k.von), f"Kreis über {k.von}->{k.nach}"


def test_unknown_endpoints_are_dropped():
    roh = ordne(1) | {"abhaengigkeiten": [{"von": 1, "nach": 999}]}
    assert norm(roh).kanten == ()


# ---------------------------------------------------------------- Robustheit


@pytest.mark.parametrize(
    "roh",
    [
        {},
        {"reihenfolge": "keine Liste"},
        {"reihenfolge": [None, 5, "x"]},
        {"zusammenfuehren": [{"prompt_ids": "nope"}]},
        {"phasen": [[]]},
        {"abhaengigkeiten": [{}]},
    ],
)
def test_junk_never_raises(roh):
    """Eine kaputte Antwort ergibt einen schwachen Vorschlag, keinen Absturz."""
    a = norm(roh)
    assert len(a.reihenfolge) == len(BEKANNT)  # alle hängen hinten an


def test_an_empty_project_yields_an_empty_proposal():
    a = schema.normalisiere({}, bekannt={})
    assert a.leer()


def test_long_text_is_clamped():
    a = norm({"zusammenfassung": "x" * 5000, "reihenfolge": [{"prompt_id": 1, "begruendung": "y" * 5000}]})
    assert len(a.zusammenfassung) == schema.MAX_ZUSAMMENFASSUNG
    assert len(a.reihenfolge[0].begruendung) == schema.MAX_BEGRUENDUNG


def test_the_serialised_shape_survives_a_round_trip():
    roh = ordne(1, 2, 3) | {
        "zusammenfuehren": [{"prompt_ids": [1, 2], "titel": "T"}],
        "phasen": [{"name": "A", "prompt_ids": [3]}],
        "abhaengigkeiten": [{"von": 1, "nach": 3}],
        "zusammenfassung": "kurz",
    }
    a = norm(roh)
    wieder = schema.normalisiere(schema.als_dict(a), bekannt=BEKANNT)
    ohne = lambda x: {k: v for k, v in schema.als_dict(x).items() if k != "hinweise"}  # noqa: E731
    assert ohne(wieder) == ohne(a)
    # Die Hinweise sind eine Eigenschaft des LAUFS, nicht des Vorschlags: über
    # bereits bereinigte Daten gibt es nichts mehr zu verwerfen.
    assert wieder.hinweise == ()
