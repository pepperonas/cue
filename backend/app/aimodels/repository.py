"""SQL des Modell-Katalogs. Keine Regeln, keine HTTP-Begriffe."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func
from sqlmodel import Session, select

from ..models import AiModel, Prompt


@dataclass(frozen=True)
class ModelWithUsage:
    model: AiModel
    #: Wie viele Prompts dieses Modell tragen.
    usage: int


class AiModelRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, user_id: int, *, include_disabled: bool = True) -> list[ModelWithUsage]:
        """Alle Modelle mit ihrer Nutzung — EIN gruppierter Join.

        Kein gespeicherter Zähler: der driftet, sobald irgendein Schreibpfad
        ihn vergisst (dieselbe Begründung wie bei den Tags).
        """
        stmt = (
            select(AiModel, func.count(Prompt.id))
            .outerjoin(Prompt, Prompt.ai_model_id == AiModel.id)
            .where(AiModel.user_id == user_id)
            .group_by(AiModel.id)
            .order_by(AiModel.sort_order, AiModel.id)
        )
        if not include_disabled:
            stmt = stmt.where(AiModel.enabled == True)  # noqa: E712
        return [ModelWithUsage(model=m, usage=int(n or 0)) for m, n in self.session.exec(stmt)]

    def get(self, user_id: int, model_id: int) -> AiModel | None:
        modell = self.session.get(AiModel, model_id)
        # 404 statt 403 für fremde Zeilen — Hausregel, s. test_tenancy.py.
        return modell if modell is not None and modell.user_id == user_id else None

    def by_name_ci(self, user_id: int, name_ci: str) -> AiModel | None:
        return self.session.exec(
            select(AiModel).where(AiModel.user_id == user_id, AiModel.name_ci == name_ci)
        ).first()

    def by_api_id(self, user_id: int, api_id: str) -> AiModel | None:
        return self.session.exec(
            select(AiModel).where(AiModel.user_id == user_id, AiModel.api_id == api_id)
        ).first()

    def default_for(self, user_id: int) -> AiModel | None:
        return self.session.exec(
            select(AiModel).where(
                AiModel.user_id == user_id,
                AiModel.is_default == True,  # noqa: E712
                AiModel.enabled == True,  # noqa: E712
            )
        ).first()

    def usage(self, user_id: int, model_id: int) -> int:
        return int(
            self.session.exec(
                select(func.count(Prompt.id)).where(
                    Prompt.user_id == user_id, Prompt.ai_model_id == model_id
                )
            ).one()
        )

    def next_sort_order(self, user_id: int) -> int:
        hoechste = self.session.exec(
            select(func.max(AiModel.sort_order)).where(AiModel.user_id == user_id)
        ).one()
        return int(hoechste or 0) + 1

    def reassign(self, user_id: int, von: int, nach: int | None) -> int:
        """Alle Prompts eines Modells umhängen. Gibt die Zahl der Treffer zurück."""
        betroffen = self.session.exec(
            select(Prompt).where(Prompt.user_id == user_id, Prompt.ai_model_id == von)
        ).all()
        for prompt in betroffen:
            prompt.ai_model_id = nach
            self.session.add(prompt)
        return len(betroffen)
