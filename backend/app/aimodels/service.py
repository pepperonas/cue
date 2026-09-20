"""Regeln des Modell-Katalogs.

Aufbau 1:1 wie `app.tags.service`: der Router übersetzt HTTP, hier stehen die
Regeln, das Repository kennt SQL. Was diesen Katalog von den Tags
unterscheidet, sind genau drei Dinge — und jedes hat einen Grund:

* **Deaktivieren schlägt Löschen.** Ein Tag verschwindet folgenlos; ein Modell
  trägt die Aussage „damit soll dieser Prompt abgearbeitet werden". Wird es
  gelöscht, ist diese Aussage weg. Ein benutztes Modell lässt sich deshalb nur
  löschen, wenn ein Ersatz genannt wird — sonst bleibt `enabled=False`.
* **Genau ein Standardmodell.** Es entscheidet, was ein neuer Prompt bekommt.
* **Eine Erstbelegung, einmal.** Der Merker sitzt am Nutzer, nicht an der Frage
  „hat er Modelle?" — wer alles bewusst löscht, soll es leer behalten.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlmodel import Session

from ..models import AiModel, Prompt, User
from . import catalog
from .repository import AiModelRepository, ModelWithUsage

log = logging.getLogger("cue.aimodels")

MAX_NAME = 80
MAX_API_ID = 120
MAX_DESCRIPTION = 300


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AiModelError(Exception):
    """Regelverstoß — der Router macht daraus einen 4xx."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _sauber(text: str | None, grenze: int) -> str:
    return " ".join((text or "").split())[:grenze]


class AiModelService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repo = AiModelRepository(session)

    # ------------------------------------------------------------- lesen

    def list(self, user_id: int, *, include_disabled: bool = True) -> list[ModelWithUsage]:
        return self.repo.list(user_id, include_disabled=include_disabled)

    def get(self, user_id: int, model_id: int) -> AiModel:
        modell = self.repo.get(user_id, model_id)
        if modell is None:
            raise AiModelError("Modell nicht gefunden", 404)
        return modell

    def default_model_id(self, user_id: int) -> int | None:
        """Was ein neuer Prompt bekommt — None, wenn nichts gesetzt ist."""
        self.seed_defaults(user_id)
        modell = self.repo.default_for(user_id)
        return modell.id if modell else None

    # ---------------------------------------------------------- schreiben

    def create(
        self,
        user_id: int,
        *,
        name: str,
        provider: str = catalog.DEFAULT_PROVIDER,
        api_id: str = "",
        description: str = "",
        color: str = "",
        enabled: bool = True,
        is_default: bool = False,
    ) -> AiModel:
        name = _sauber(name, MAX_NAME)
        if not name:
            raise AiModelError("Ein Modell braucht einen Namen")
        if self.repo.by_name_ci(user_id, name.lower()):
            raise AiModelError(f"„{name}“ gibt es bereits", 409)
        modell = AiModel(
            user_id=user_id,
            name=name,
            name_ci=name.lower(),
            provider=_sauber(provider, 40).lower() or catalog.DEFAULT_PROVIDER,
            api_id=_sauber(api_id, MAX_API_ID),
            description=_sauber(description, MAX_DESCRIPTION),
            color=_sauber(color, 24),
            enabled=enabled,
            sort_order=self.repo.next_sort_order(user_id),
        )
        self.session.add(modell)
        self.session.commit()
        self.session.refresh(modell)
        if is_default:
            self.set_default(user_id, modell.id)
            self.session.refresh(modell)
        return modell

    def update(
        self,
        user_id: int,
        model_id: int,
        *,
        name: str | None = None,
        provider: str | None = None,
        api_id: str | None = None,
        description: str | None = None,
        color: str | None = None,
        enabled: bool | None = None,
    ) -> AiModel:
        modell = self.get(user_id, model_id)
        if name is not None:
            neu = _sauber(name, MAX_NAME)
            if not neu:
                raise AiModelError("Ein Modell braucht einen Namen")
            kollision = self.repo.by_name_ci(user_id, neu.lower())
            # Nur Groß-/Kleinschreibung zu ändern ist keine Kollision mit sich
            # selbst — sonst ließe sich „claude opus" nicht zu „Claude Opus"
            # korrigieren.
            if kollision is not None and kollision.id != modell.id:
                raise AiModelError(f"„{neu}“ gibt es bereits", 409)
            modell.name = neu
            modell.name_ci = neu.lower()
        if provider is not None:
            modell.provider = _sauber(provider, 40).lower() or catalog.DEFAULT_PROVIDER
        if api_id is not None:
            modell.api_id = _sauber(api_id, MAX_API_ID)
        if description is not None:
            modell.description = _sauber(description, MAX_DESCRIPTION)
        if color is not None:
            modell.color = _sauber(color, 24)
        if enabled is not None:
            modell.enabled = enabled
            # ⚠️ Ein abgeschaltetes Modell kann nicht der Standard sein: sonst
            # bekäme jeder neue Prompt etwas zugewiesen, das nirgends
            # auswählbar ist.
            if not enabled and modell.is_default:
                modell.is_default = False
        modell.updated_at = utcnow()
        self.session.add(modell)
        self.session.commit()
        self.session.refresh(modell)
        return modell

    def set_default(self, user_id: int, model_id: int | None) -> AiModel | None:
        """Genau ein Standardmodell je Mandant — None hebt es auf."""
        aktuell = self.repo.default_for(user_id)
        if aktuell is not None and aktuell.id != model_id:
            aktuell.is_default = False
            self.session.add(aktuell)
        if model_id is None:
            self.session.commit()
            return None
        modell = self.get(user_id, model_id)
        if not modell.enabled:
            raise AiModelError("Ein deaktiviertes Modell kann nicht der Standard sein")
        modell.is_default = True
        modell.updated_at = utcnow()
        self.session.add(modell)
        self.session.commit()
        self.session.refresh(modell)
        return modell

    def delete(self, user_id: int, model_id: int, *, replace_with: int | None = None) -> int:
        """Löschen. Gibt zurück, wie viele Prompts umgehängt wurden.

        ⚠️ Ein benutztes Modell zu löschen, ohne zu sagen wohin, wird
        ABGELEHNT: die Zuordnung ginge verloren und die betroffenen Prompts
        stünden wieder auf „kein Modell". Deaktivieren ist der Weg, der die
        Information behält — der Fehlertext sagt das.
        """
        modell = self.get(user_id, model_id)
        genutzt = self.repo.usage(user_id, model_id)
        if genutzt and replace_with is None:
            raise AiModelError(
                f"„{modell.name}“ ist {genutzt} Prompt(s) zugeordnet. Deaktiviere es, "
                "oder gib beim Löschen ein Ersatzmodell an.",
                409,
            )
        umgehaengt = 0
        if genutzt:
            ersatz = self.get(user_id, replace_with)  # 404, wenn fremd/unbekannt
            if ersatz.id == modell.id:
                raise AiModelError("Ein Modell kann sich nicht selbst ersetzen")
            umgehaengt = self.repo.reassign(user_id, model_id, ersatz.id)
        self.session.delete(modell)
        self.session.commit()
        log.info("ai model deleted id=%s reassigned=%s", model_id, umgehaengt)
        return umgehaengt

    def reorder(self, user_id: int, ids: list[int]) -> None:
        """Reihenfolge setzen — wie `projects.reorder`, nur die genannten Zeilen."""
        eigene = {m.model.id: m.model for m in self.repo.list(user_id)}
        for platz, mid in enumerate(ids, start=1):
            modell = eigene.get(mid)
            if modell is None:
                continue  # Unbekanntes still überspringen, nie den ganzen Zug verwerfen
            modell.sort_order = platz
            self.session.add(modell)
        self.session.commit()

    # ------------------------------------------------------- Erstbelegung

    def seed_defaults(self, user_id: int) -> int:
        """Die recherchierten Start-Modelle anlegen — genau einmal je Mandant.

        Gibt zurück, wie viele angelegt wurden. Der Merker sitzt am Nutzer:
        „hat keine Modelle" wäre nicht von „hat alle gelöscht" zu unterscheiden.
        """
        nutzer = self.session.get(User, user_id)
        if nutzer is None or nutzer.ai_models_seeded:
            return 0
        angelegt = 0
        standard: AiModel | None = None
        for eintrag in catalog.DEFAULTS:
            # Doppelte überspringen statt abbrechen: ein Nutzer könnte einen
            # Namen bereits von Hand vergeben haben.
            if self.repo.by_name_ci(user_id, eintrag.name.lower()):
                continue
            modell = AiModel(
                user_id=user_id,
                name=eintrag.name,
                name_ci=eintrag.name.lower(),
                api_id=eintrag.api_id,
                provider=eintrag.provider,
                description=eintrag.description,
                enabled=True,
                sort_order=self.repo.next_sort_order(user_id),
            )
            self.session.add(modell)
            self.session.commit()
            self.session.refresh(modell)
            angelegt += 1
            if eintrag.default:
                standard = modell
        nutzer.ai_models_seeded = True
        self.session.add(nutzer)
        self.session.commit()
        if standard is not None and self.repo.default_for(user_id) is None:
            self.set_default(user_id, standard.id)
        log.info("ai models seeded user=%s created=%s", user_id, angelegt)
        return angelegt

    # -------------------------------------------- Empfehlung der Optimierung

    def apply_recommendation(self, prompt: Prompt, model_string: str | None) -> bool:
        """Nach einer Optimierung das genutzte Claude-Code-Modell setzen.

        Gibt True zurück, wenn etwas geändert wurde. Legt einen fehlenden
        Katalog-Eintrag NICHT an — der Katalog gehört dem Nutzer, und ein Lauf
        soll ihn nicht heimlich erweitern.
        """
        if prompt.user_id is None:
            return False
        # ⚠️ Auch hier die Erstbelegung anstoßen: ohne Katalog fände die
        # Empfehlung nichts, und ein Nutzer, der den Katalog nie geöffnet hat,
        # bekäme sie stillschweigend nie. Der Merker hält sie einmalig.
        self.seed_defaults(prompt.user_id)
        api_id = catalog.claude_code_empfehlung(model_string)
        if not api_id:
            return False
        modell = self.repo.by_api_id(prompt.user_id, api_id)
        if modell is None or not modell.enabled or prompt.ai_model_id == modell.id:
            return False
        prompt.ai_model_id = modell.id
        self.session.add(prompt)
        return True
