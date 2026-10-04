"""Invarianten des recherchierten Start-Katalogs (`app/aimodels/catalog.py`).

Der Katalog ist Daten, keine Logik — aber Daten, die bei jeder Auffrischung
von Hand angefasst werden. Diese Tests halten fest, was dabei nicht kaputtgehen
darf: eindeutige Namen und Kennungen, genau ein Standard, nur bekannte Anbieter,
eine plausible Fassungsnummer je Eintrag, und dass Katalog und Preistabelle der
Optimierung dasselbe Claude-Modell als Standard meinen.
"""
from __future__ import annotations

import pytest

from app.aimodels import catalog
from app.optimization import pricing


def test_names_and_api_ids_are_unique():
    namen = [m.name.lower() for m in catalog.DEFAULTS]
    kennungen = [m.api_id for m in catalog.DEFAULTS]
    assert len(set(namen)) == len(namen)
    assert len(set(kennungen)) == len(kennungen)


def test_exactly_one_default():
    assert [m.name for m in catalog.DEFAULTS if m.default] == ["Claude Opus 5.5"]


def test_every_entry_names_a_known_provider():
    unbekannt = {m.provider for m in catalog.DEFAULTS} - set(catalog.PROVIDERS)
    assert unbekannt == set()


def test_every_entry_carries_a_valid_version():
    for m in catalog.DEFAULTS:
        assert 1 <= m.seit <= catalog.KATALOG_VERSION, m.name
    # Die aktuelle Fassung muss etwas Neues bringen — sonst wäre die Nummer umsonst.
    assert any(m.seit == catalog.KATALOG_VERSION for m in catalog.DEFAULTS)


def test_legacy_models_are_not_seeded_any_more():
    legacy = {m.api_id for m in catalog.CLAUDE_LEGACY}
    assert legacy.isdisjoint({m.api_id for m in catalog.DEFAULTS})


def test_all_three_ecosystems_are_offered():
    anbieter = {m.provider for m in catalog.DEFAULTS}
    assert {"anthropic", "openai", "google"} <= anbieter


def test_google_provider_is_labelled_for_antigravity():
    spec = catalog.provider("google")
    assert spec.label == "Antigravity · Gemini"
    assert spec.kuerzel == "AG"


def test_an_unknown_provider_stays_valid_and_neutral():
    spec = catalog.provider("mistral")
    assert spec.id == "mistral"
    assert spec.color == catalog.PROVIDERS["custom"].color
    assert catalog.provider(None).id == catalog.DEFAULT_PROVIDER


def test_every_seeded_claude_model_has_a_price():
    """Wer im Katalog ein Claude-Modell findet, soll damit auch optimieren können."""
    ohne_preis = [
        m.api_id
        for m in catalog.DEFAULTS + catalog.CLAUDE_LEGACY
        if m.provider == "anthropic" and pricing.get(m.api_id) is None
    ]
    assert ohne_preis == []


def test_catalogue_and_price_table_agree_on_the_default():
    standard = next(m for m in catalog.DEFAULTS if m.default)
    assert pricing.DEFAULT_MODEL == standard.api_id


@pytest.mark.parametrize(
    "gemeldet, erwartet",
    [
        ("claude-opus-5-5", "claude-opus-5-5"),
        ("CLAUDE-OPUS-5-5[1m]", "claude-opus-5-5"),
        ("  sonnet  ", "claude-sonnet-5-5"),
        ("haiku", "claude-haiku-4-5"),
        ("fable", "claude-fable-5-1"),
        ("claude-sonnet-5", "claude-sonnet-5"),  # Legacy, exakt
        ("gpt-6-astra", None),  # kein Claude-Code-Modell
        ("gemini-3.8-flash", None),
        ("", None),
        (None, None),
    ],
)
def test_the_optimizer_recommendation_resolves(gemeldet, erwartet):
    assert catalog.claude_code_empfehlung(gemeldet) == erwartet
