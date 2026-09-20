"""Was im Prompt landet — und vor allem, was nicht."""
from __future__ import annotations

import pytest

from app.analysis import meta_prompt as mp


def p(i: int, body: str = "Inhalt", **kw) -> mp.OffenerPrompt:
    return mp.OffenerPrompt(id=i, titel=f"Titel {i}", body=body, **kw)


def bauen(offene, erledigte=None) -> str:
    return mp.build_analysis_prompt(projekt="demo", offene=offene, erledigte_titel=erledigte)


def test_every_open_prompt_appears_with_its_id():
    text = bauen([p(1), p(2), p(3)])
    for i in (1, 2, 3):
        assert f"### Prompt {i}:" in text


def test_the_budget_is_shared_evenly():
    """Nicht „die ersten N vollständig": sonst werden die letzten geraten."""
    assert mp.budget_je_prompt(20) == mp.MAX_TOTAL_CHARS // 20
    assert mp.budget_je_prompt(1) == mp.MAX_PROMPT_CHARS      # gedeckelt
    assert mp.budget_je_prompt(500) == mp.MIN_PROMPT_CHARS    # Boden
    assert mp.budget_je_prompt(0) == mp.MAX_PROMPT_CHARS      # kein Teilen durch 0


def test_a_truncated_prompt_says_so():
    """Ein abgeschnittener Prompt, der vollständig aussieht, wird falsch eingeordnet."""
    text = bauen([p(1, "x" * 50_000)])
    assert "[… gekürzt" in text


def test_a_short_prompt_is_not_touched():
    text = bauen([p(1, "kurz und knapp")])
    assert "gekürzt" not in text
    assert "kurz und knapp" in text


def test_the_whole_prompt_stays_within_budget_for_the_largest_real_project():
    """Gemessen am echten Bestand: 20 Prompts, 206k Zeichen."""
    text = bauen([p(i, "x" * 22_000) for i in range(1, 21)])
    assert len(text) < mp.MAX_TOTAL_CHARS + 20_000


def test_priority_and_blocked_are_stated_only_when_they_deviate():
    schlicht = bauen([p(1)])
    assert "Priorität" not in schlicht
    assert "BLOCKIERT" not in schlicht

    besonders = bauen([p(1, prioritaet="high", blockiert=True)])
    assert "Priorität: high" in besonders
    assert "BLOCKIERT" in besonders


def test_done_titles_are_capped_and_labelled():
    text = bauen([p(1)], [f"erledigt {i}" for i in range(200)])
    assert text.count("- erledigt ") == mp.MAX_ERLEDIGTE
    assert f"die {mp.MAX_ERLEDIGTE} jüngsten" in text


def test_without_done_titles_the_section_is_absent():
    assert "Bereits erledigt" not in bauen([p(1)])


def test_blank_done_titles_do_not_create_empty_bullets():
    text = bauen([p(1)], ["echt", "  ", ""])
    assert text.count("- ") >= 1
    assert "- \n" not in text


def test_the_schema_names_every_key_the_parser_reads():
    """Der Prompt und der Vertrag dürfen nicht auseinanderlaufen."""
    for schluessel in (
        "reihenfolge",
        "zusammenfuehren",
        "redundant",
        "phasen",
        "abhaengigkeiten",
        "zusammenfassung",
        "prompt_id",
        "prioritaet",
        "abgedeckt_von",
    ):
        assert schluessel in mp.SCHEMA, schluessel


def test_the_rules_forbid_inventing_ids():
    """Die Regel, deren Verletzung der Parser danach aufräumen müsste."""
    assert "Erfinde keine" in mp.REGELN
    assert "genau einmal" in mp.REGELN


@pytest.mark.parametrize("anzahl", [0, 1, 7, 20, 200])
def test_building_never_raises(anzahl):
    assert bauen([p(i) for i in range(anzahl)])
