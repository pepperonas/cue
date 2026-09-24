"""Die einzige Tür für Geräte-Token: `/api/app/`.

Was hier liegt, darf ein Telefon. Was hier fehlt, darf es nicht — nicht durch
eine Prüfung, sondern weil es die Route nicht gibt. `APP_ROUTES` ist die
Soll-Liste; `tests/test_app_surface.py` hält den Router daran fest.

Die Handler sind dünn: sie rufen die Cookie-Handler direkt auf. Titel-Ableitung,
Tag-Vokabular, Bug-nach-oben und Statusregeln existieren genau einmal.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from ..db import get_session
from ..deps import device_user_id
from ..schemas import (
    AppPromptCreate,
    AppPromptUpdate,
    ProjectRead,
    PromptCreate,
    PromptRead,
    PromptUpdate,
    TagListResponse,
)
from . import projects as projects_router
from . import prompts as prompts_router
from . import tags as tags_router

router = APIRouter(prefix="/app", tags=["app"])

APP_ROUTES = frozenset(
    {
        "GET /app/prompts",
        "POST /app/prompts",
        "PATCH /app/prompts/{prompt_id}",
        "GET /app/projects",
        "GET /app/tags",
        "GET /app/changes",
    }
)


@router.get("/prompts", response_model=list[PromptRead])
def app_list_prompts(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return prompts_router.list_prompts(
        project_id=None, status_filter=None, q=None, session=session, uid=uid
    )


@router.post("/prompts", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def app_create_prompt(
    payload: AppPromptCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    # Kein ai_model_id mitgeben: „weggelassen" heißt beim Web-Handler
    # „Standardmodell des Mandanten" (model_fields_set).
    return prompts_router.create_prompt(
        payload=PromptCreate(**payload.model_dump()), session=session, uid=uid, _csrf=None
    )


@router.patch("/prompts/{prompt_id}", response_model=PromptRead)
def app_update_prompt(
    prompt_id: int,
    payload: AppPromptUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return prompts_router.update_prompt(
        prompt_id=prompt_id,
        payload=PromptUpdate(**payload.model_dump(exclude_unset=True)),
        session=session,
        uid=uid,
        _csrf=None,
    )


@router.get("/projects", response_model=list[ProjectRead])
def app_list_projects(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return projects_router.list_projects(session=session, uid=uid)


@router.get("/tags", response_model=TagListResponse)
def app_list_tags(
    session: Session = Depends(get_session),
    uid: int = Depends(device_user_id),
):
    return tags_router.list_tags(
        q=None, sort="usage", limit=2000, offset=0, session=session, uid=uid
    )
