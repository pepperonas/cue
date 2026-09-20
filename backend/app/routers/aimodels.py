"""Modell-Katalog — HTTP-Hülle um `app.aimodels`.

Aufbau wie `routers/tags.py`: keine Regel lebt hier. Alle Endpunkte sind
mandanten-gebunden (`current_user_id`) und damit für jeden freigeschalteten
Nutzer offen — ein Modellkatalog kostet nichts und gehört zum eigenen Konto,
anders als die Läufe und die Optimierung.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from ..aimodels import AiModelError, AiModelService
from ..aimodels import catalog
from ..aimodels.repository import ModelWithUsage
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import AiModel
from ..schemas import (
    AiModelCreate,
    AiModelDeleteResult,
    AiModelListResponse,
    AiModelProviderRead,
    AiModelRead,
    AiModelReorder,
    AiModelUpdate,
)

router = APIRouter(prefix="/models", tags=["models"])


def _fail(exc: AiModelError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _read(modell: AiModel, usage: int = 0) -> AiModelRead:
    spec = catalog.provider(modell.provider)
    return AiModelRead(
        id=modell.id,
        name=modell.name,
        provider=modell.provider,
        provider_label=spec.label,
        provider_short=spec.kuerzel,
        # Eigene Farbe schlägt die des Anbieters — sonst gäbe es keinen Weg,
        # zwei Modelle desselben Anbieters optisch zu trennen.
        color=modell.color or spec.color,
        api_id=modell.api_id,
        description=modell.description,
        enabled=modell.enabled,
        is_default=modell.is_default,
        sort_order=modell.sort_order,
        usage=usage,
    )


def _read_row(row: ModelWithUsage) -> AiModelRead:
    return _read(row.model, row.usage)


@router.get("", response_model=AiModelListResponse)
def list_models(
    include_disabled: bool = Query(True),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> AiModelListResponse:
    service = AiModelService(session)
    # Erstbelegung beim ersten Blick in den Katalog: ein Nutzer, der vor
    # diesem Feature angelegt wurde, hat den Merker nicht und bekommt die
    # recherchierten Modelle hier — genau einmal.
    service.seed_defaults(uid)
    return AiModelListResponse(
        models=[_read_row(r) for r in service.list(uid, include_disabled=include_disabled)],
        providers=[
            AiModelProviderRead(id=s.id, label=s.label, short=s.kuerzel, color=s.color)
            for s in catalog.PROVIDERS.values()
        ],
        catalog_state=catalog.STAND,
    )


@router.post("", response_model=AiModelRead, status_code=status.HTTP_201_CREATED)
def create_model(
    payload: AiModelCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AiModelRead:
    try:
        modell = AiModelService(session).create(
            uid,
            name=payload.name,
            provider=payload.provider,
            api_id=payload.api_id,
            description=payload.description,
            color=payload.color,
            enabled=payload.enabled,
            is_default=payload.is_default,
        )
    except AiModelError as exc:
        raise _fail(exc) from exc
    return _read(modell)


@router.patch("/{model_id}", response_model=AiModelRead)
def update_model(
    model_id: int,
    payload: AiModelUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AiModelRead:
    service = AiModelService(session)
    try:
        modell = service.update(
            uid,
            model_id,
            name=payload.name,
            provider=payload.provider,
            api_id=payload.api_id,
            description=payload.description,
            color=payload.color,
            enabled=payload.enabled,
        )
        if payload.is_default is True:
            service.set_default(uid, model_id)
        elif payload.is_default is False and modell.is_default:
            service.set_default(uid, None)
        session.refresh(modell)
    except AiModelError as exc:
        raise _fail(exc) from exc
    return _read(modell, service.repo.usage(uid, model_id))


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
def reorder_models(
    payload: AiModelReorder,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    AiModelService(session).reorder(uid, payload.ids)


@router.delete("/{model_id}", response_model=AiModelDeleteResult)
def delete_model(
    model_id: int,
    replace_with: int | None = Query(None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AiModelDeleteResult:
    try:
        umgehaengt = AiModelService(session).delete(uid, model_id, replace_with=replace_with)
    except AiModelError as exc:
        raise _fail(exc) from exc
    return AiModelDeleteResult(deleted=1, reassigned=umgehaengt)
