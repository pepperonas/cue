"""Der Modell-Katalog über die echte HTTP-Oberfläche.

Schwerpunkt liegt auf dem, was den Katalog von den Tags unterscheidet: die
Erstbelegung darf genau einmal laufen, ein benutztes Modell darf nicht
verschwinden, und es gibt höchstens ein Standardmodell.
"""
from __future__ import annotations

import pytest

from conftest import auth


def hdr(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}


def katalog(client) -> dict:
    r = client.get("/api/models")
    assert r.status_code == 200, r.text
    return r.json()


def namen(client) -> list[str]:
    return [m["name"] for m in katalog(client)["models"]]


def modell(client, name: str) -> dict:
    return next(m for m in katalog(client)["models"] if m["name"] == name)


def prompt(client, csrf, **kw) -> dict:
    r = client.post("/api/prompts", json={"body": "Inhalt", **kw}, headers=hdr(csrf))
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------- Erstbelegung


def test_the_researched_defaults_are_seeded_on_first_look(client):
    auth(client)
    daten = katalog(client)
    liste = [m["name"] for m in daten["models"]]
    # Die Namen stammen aus `aimodels/catalog.py` — Quelle und Stand stehen dort.
    assert "Claude Opus 5" in liste
    assert "Codex Astra" in liste
    assert daten["catalog_state"], "der Stand der Recherche gehört in die Antwort"
    assert {p["id"] for p in daten["providers"]} >= {"anthropic", "openai", "custom"}


def test_seeding_runs_exactly_once(client):
    """Kein zweiter Satz beim nächsten Aufruf — und auch nicht nach dem Löschen."""
    csrf = auth(client)
    erste = namen(client)
    assert namen(client) == erste, "der zweite Aufruf hat noch einmal angelegt"

    # Alles wegräumen: der Katalog muss leer BLEIBEN.
    for m in katalog(client)["models"]:
        client.delete(f"/api/models/{m['id']}", headers=hdr(csrf))
    assert katalog(client)["models"] == []


def test_exactly_one_model_is_the_default(client):
    auth(client)
    standard = [m for m in katalog(client)["models"] if m["is_default"]]
    assert len(standard) == 1
    assert standard[0]["name"] == "Claude Opus 5"


def test_every_seeded_model_carries_its_api_id(client):
    """Ein Katalog-Eintrag ohne Kennung wäre nur ein Zettel."""
    auth(client)
    for m in katalog(client)["models"]:
        assert m["api_id"], m["name"]
        assert m["provider"] in ("anthropic", "openai")


# ------------------------------------------------------------------- CRUD


def test_a_custom_model_can_be_added(client):
    csrf = auth(client)
    r = client.post(
        "/api/models",
        json={"name": "Mein Modell", "provider": "custom", "api_id": "eigen-1"},
        headers=hdr(csrf),
    )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Mein Modell"
    assert "Mein Modell" in namen(client)


def test_names_are_unique_per_tenant_regardless_of_case(client):
    csrf = auth(client)
    client.post("/api/models", json={"name": "Eigen"}, headers=hdr(csrf))
    zweite = client.post("/api/models", json={"name": "eigen"}, headers=hdr(csrf))
    assert zweite.status_code == 409


def test_renaming_works_and_keeps_the_assignment(client):
    csrf = auth(client)
    m = modell(client, "Claude Opus 5")
    p = prompt(client, csrf, ai_model_id=m["id"])
    r = client.patch(f"/api/models/{m['id']}", json={"name": "Opus"}, headers=hdr(csrf))
    assert r.status_code == 200, r.text
    # Der Prompt verweist auf die ID, nicht auf den Namen — deshalb ändert ein
    # Umbenennen an ihm nichts.
    gelesen = client.get(f"/api/prompts/{p['id']}").json()
    assert gelesen["ai_model_id"] == m["id"]
    assert modell(client, "Opus")["usage"] == 1


def test_only_the_case_may_be_corrected(client):
    """Sonst ließe sich „claude opus“ nicht zu „Claude Opus“ berichtigen."""
    csrf = auth(client)
    m = modell(client, "Claude Opus 5")
    r = client.patch(f"/api/models/{m['id']}", json={"name": "CLAUDE OPUS 5"}, headers=hdr(csrf))
    assert r.status_code == 200, r.text


def test_disabling_keeps_the_model_and_its_assignments(client):
    csrf = auth(client)
    m = modell(client, "Claude Sonnet 5")
    p = prompt(client, csrf, ai_model_id=m["id"])
    client.patch(f"/api/models/{m['id']}", json={"enabled": False}, headers=hdr(csrf))

    assert modell(client, "Claude Sonnet 5")["enabled"] is False
    # Die Zuordnung bleibt — genau darum geht es beim Deaktivieren.
    assert client.get(f"/api/prompts/{p['id']}").json()["ai_model_id"] == m["id"]
    # Angeboten wird es nicht mehr.
    aktiv = client.get("/api/models?include_disabled=false").json()["models"]
    assert m["id"] not in [x["id"] for x in aktiv]


def test_disabling_the_default_clears_the_default(client):
    """Sonst bekäme jeder neue Prompt etwas, das nirgends auswählbar ist."""
    csrf = auth(client)
    m = modell(client, "Claude Opus 5")
    client.patch(f"/api/models/{m['id']}", json={"enabled": False}, headers=hdr(csrf))
    assert modell(client, "Claude Opus 5")["is_default"] is False


def test_a_disabled_model_cannot_become_the_default(client):
    csrf = auth(client)
    m = modell(client, "Claude Haiku 4.5")
    client.patch(f"/api/models/{m['id']}", json={"enabled": False}, headers=hdr(csrf))
    r = client.patch(f"/api/models/{m['id']}", json={"is_default": True}, headers=hdr(csrf))
    assert r.status_code == 400


def test_setting_a_new_default_clears_the_old_one(client):
    csrf = auth(client)
    neu = modell(client, "Codex Astra")
    client.patch(f"/api/models/{neu['id']}", json={"is_default": True}, headers=hdr(csrf))
    standard = [m["name"] for m in katalog(client)["models"] if m["is_default"]]
    assert standard == ["Codex Astra"]


def test_models_can_be_reordered(client):
    csrf = auth(client)
    ids = [m["id"] for m in katalog(client)["models"]]
    gedreht = list(reversed(ids))
    assert client.post(
        "/api/models/reorder", json={"ids": gedreht}, headers=hdr(csrf)
    ).status_code == 204
    assert [m["id"] for m in katalog(client)["models"]] == gedreht


# ------------------------------------------------------------------ Löschen


def test_deleting_an_unused_model_is_plain(client):
    csrf = auth(client)
    m = modell(client, "Codex 5.6 Luna")
    r = client.delete(f"/api/models/{m['id']}", headers=hdr(csrf))
    assert r.status_code == 200
    assert "Codex 5.6 Luna" not in namen(client)


def test_deleting_a_used_model_is_refused_and_names_the_way_out(client):
    """Die Zuordnung ginge sonst verloren — Deaktivieren behält sie."""
    csrf = auth(client)
    m = modell(client, "Claude Fable 5.1")
    prompt(client, csrf, ai_model_id=m["id"])
    r = client.delete(f"/api/models/{m['id']}", headers=hdr(csrf))
    assert r.status_code == 409
    assert "Deaktiviere" in r.json()["detail"]
    assert "Claude Fable 5.1" in namen(client)


def test_a_used_model_can_be_deleted_with_a_replacement(client):
    csrf = auth(client)
    alt = modell(client, "Claude Fable 5.1")
    neu = modell(client, "Claude Sonnet 5")
    p = prompt(client, csrf, ai_model_id=alt["id"])

    r = client.delete(f"/api/models/{alt['id']}?replace_with={neu['id']}", headers=hdr(csrf))
    assert r.status_code == 200, r.text
    assert r.json()["reassigned"] == 1
    assert client.get(f"/api/prompts/{p['id']}").json()["ai_model_id"] == neu["id"]


def test_a_model_cannot_replace_itself(client):
    csrf = auth(client)
    m = modell(client, "Claude Sonnet 5")
    prompt(client, csrf, ai_model_id=m["id"])
    r = client.delete(f"/api/models/{m['id']}?replace_with={m['id']}", headers=hdr(csrf))
    assert r.status_code == 400


# ------------------------------------------------------------------ Prompts


def test_a_new_prompt_gets_the_default_model(client):
    csrf = auth(client)
    standard = modell(client, "Claude Opus 5")
    assert prompt(client, csrf)["ai_model_id"] == standard["id"]


def test_an_explicit_null_means_deliberately_none(client):
    """`ai_model_id: null` ist eine Aussage, kein fehlendes Feld."""
    csrf = auth(client)
    r = client.post(
        "/api/prompts", json={"body": "x", "ai_model_id": None}, headers=hdr(csrf)
    )
    assert r.status_code == 201
    assert r.json()["ai_model_id"] is None


def test_without_a_default_a_new_prompt_has_none(client):
    csrf = auth(client)
    standard = modell(client, "Claude Opus 5")
    client.patch(f"/api/models/{standard['id']}", json={"is_default": False}, headers=hdr(csrf))
    assert prompt(client, csrf)["ai_model_id"] is None


def test_the_model_can_be_changed_and_cleared(client):
    csrf = auth(client)
    p = prompt(client, csrf)
    ziel = modell(client, "Codex Astra")

    r = client.patch(f"/api/prompts/{p['id']}", json={"ai_model_id": ziel["id"]}, headers=hdr(csrf))
    assert r.status_code == 200
    assert r.json()["ai_model_id"] == ziel["id"]

    r = client.patch(f"/api/prompts/{p['id']}", json={"unassign_model": True}, headers=hdr(csrf))
    assert r.json()["ai_model_id"] is None


def test_a_disabled_model_cannot_be_assigned(client):
    csrf = auth(client)
    m = modell(client, "Codex 5.6 Sol")
    client.patch(f"/api/models/{m['id']}", json={"enabled": False}, headers=hdr(csrf))
    p = prompt(client, csrf)
    r = client.patch(f"/api/prompts/{p['id']}", json={"ai_model_id": m["id"]}, headers=hdr(csrf))
    assert r.status_code == 400


def test_a_foreign_model_is_not_found(client):
    # ⚠️ `auth()` LEGT den Nutzer an — zweimal mit derselben Adresse kollidiert.
    # Der Besitzer wird einmal angelegt und seine Sitzung danach nur wieder
    # gesetzt.
    eigen = auth(client)
    eigene_sitzung = dict(client.cookies)
    fremd = auth(client, "fremd@example.com", sub="s2")
    fremdes = client.post("/api/models", json={"name": "Fremd"}, headers=hdr(fremd)).json()

    for k, v in eigene_sitzung.items():
        client.cookies.set(k, v)
    r = client.post(
        "/api/prompts", json={"body": "x", "ai_model_id": fremdes["id"]}, headers=hdr(eigen)
    )
    assert r.status_code == 404


def test_prompts_from_before_the_feature_keep_working(client):
    """Migration: eine Zeile ohne Modell bleibt eine gültige Zeile."""
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    csrf = auth(client)
    p = prompt(client, csrf)
    with Session(db_module.engine) as s:
        alt = s.get(Prompt, p["id"])
        alt.ai_model_id = None  # der Zustand vor dieser Version
        s.add(alt)
        s.commit()

    gelesen = client.get(f"/api/prompts/{p['id']}").json()
    assert gelesen["ai_model_id"] is None
    # Und er lässt sich weiterhin normal bearbeiten.
    assert client.patch(
        f"/api/prompts/{p['id']}", json={"title": "neu"}, headers=hdr(csrf)
    ).status_code == 200


def test_several_models_of_one_provider_stay_distinguishable(client):
    auth(client)
    claude = [m for m in katalog(client)["models"] if m["provider"] == "anthropic"]
    assert len(claude) >= 3
    assert len({m["name"] for m in claude}) == len(claude)
    assert len({m["api_id"] for m in claude}) == len(claude)


def test_a_merged_prompt_keeps_a_model_through_unmerge(client):
    csrf = auth(client)
    ziel = modell(client, "Codex Astra")
    a = prompt(client, csrf, ai_model_id=ziel["id"], title="Mit Modell")
    b = prompt(client, csrf, title="Ohne")
    r = client.post(
        "/api/prompts/merge",
        json={"source_ids": [a["id"], b["id"]], "title": "Z", "body": "zusammen", "originals": "delete"},
        headers=hdr(csrf),
    )
    assert r.status_code in (200, 201), r.text
    zusammen = r.json()
    zurueck = client.post(f"/api/prompts/{zusammen['id']}/unmerge", json={}, headers=hdr(csrf))
    assert zurueck.status_code == 200, zurueck.text
    # ⚠️ Als LISTE prüfen, nicht über ein dict nach Titel: beide Prompts
    # bekämen denselben abgeleiteten Titel, und der zweite überschriebe den
    # ersten stillschweigend (genau so ist dieser Test zuerst fehlgeschlagen).
    wieder = zurueck.json()
    assert len(wieder) == 2
    assert [p["ai_model_id"] for p in wieder].count(ziel["id"]) == 1


# ------------------------------------------------------- Empfehlung der KI


@pytest.mark.parametrize(
    "gemeldet,erwartet",
    [
        ("claude-opus-5", "Claude Opus 5"),
        ("opus", "Claude Opus 5"),
        ("claude-opus-5[1m]", "Claude Opus 5"),
        ("sonnet", "Claude Sonnet 5"),
    ],
)
def test_the_optimizer_sets_the_model_it_used(client, gemeldet, erwartet):
    """Womit optimiert wurde, damit soll der Prompt abgearbeitet werden."""
    from app.aimodels import AiModelService
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    csrf = auth(client)
    p = prompt(client, csrf, ai_model_id=None)
    with Session(db_module.engine) as s:
        zeile = s.get(Prompt, p["id"])
        geaendert = AiModelService(s).apply_recommendation(zeile, gemeldet)
        s.commit()
        assert geaendert
    assert client.get(f"/api/prompts/{p['id']}").json()["ai_model_id"] == modell(client, erwartet)["id"]


def test_a_codex_model_is_no_claude_code_recommendation(client):
    """Die Empfehlung gilt nur für Claude Code — sonst wäre sie geraten."""
    from app.aimodels import AiModelService
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    csrf = auth(client)
    p = prompt(client, csrf, ai_model_id=None)
    with Session(db_module.engine) as s:
        assert AiModelService(s).apply_recommendation(s.get(Prompt, p["id"]), "gpt-6-astra") is False


def test_the_recommendation_never_invents_a_catalog_entry(client):
    csrf = auth(client)
    vorher = namen(client)
    m = modell(client, "Claude Opus 5")
    client.delete(f"/api/models/{m['id']}", headers=hdr(csrf))

    from app.aimodels import AiModelService
    import app.db as db_module
    from sqlmodel import Session

    from app.models import Prompt

    p = prompt(client, csrf, ai_model_id=None)
    with Session(db_module.engine) as s:
        assert AiModelService(s).apply_recommendation(s.get(Prompt, p["id"]), "opus") is False
    assert "Claude Opus 5" not in namen(client)
    assert len(namen(client)) == len(vorher) - 1
