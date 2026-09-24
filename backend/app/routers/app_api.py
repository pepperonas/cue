"""Die einzige Tür für Geräte-Token: `/api/app/`.

Was hier liegt, darf ein Telefon. Was hier fehlt, darf es nicht — nicht durch
eine Prüfung, sondern weil es die Route nicht gibt. `APP_ROUTES` ist die
Soll-Liste; `tests/test_app_surface.py` hält den Router daran fest.

Die Handler sind dünn: sie rufen die Cookie-Handler direkt auf. Titel-Ableitung,
Tag-Vokabular, Bug-nach-oben und Statusregeln existieren genau einmal.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session

from .. import changes as changes_mod
from .. import db
from .. import devices
from ..db import get_session
from ..deps import bearer_token, device_user_id
from ..longpoll import claim_with_wait
from ..models import User
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


#: Was die App kennt. Snippets und Capture-Sitzungen bewegen den Cursor der
#: Web-App, sollen das Telefon aber nicht wecken.
APP_ENTITIES = (changes_mod.PROMPTS, changes_mod.PROJECTS, changes_mod.TAGS)


class AppChangeFeed(BaseModel):
    cursor: str
    changed: list[str] = []


def _app_fingerprint(session: Session, uid: int) -> dict[str, str]:
    full = changes_mod.fingerprint(session, uid)
    return {k: v for k, v in full.items() if k in APP_ENTITIES}


def _check_device(session: Session, token: str) -> int:
    device = devices.resolve(session, token)
    if device is None:
        raise HTTPException(status_code=401, detail="Invalid device token")
    user = session.get(User, device.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid device token")
    if not user.approved:
        raise HTTPException(status_code=403, detail="Konto wartet auf Freischaltung")
    return user.id


@router.get("/changes", response_model=AppChangeFeed)
async def app_changes(
    since: str | None = Query(None),
    wait: float = Query(0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Wie `/api/changes`, aber per Geräte-Token.

    ⚠️ Kein `Depends(get_session)` und kein `device_user_id`: die Anfrage kann
    bis zu 25 s geparkt sein, der Pool hat fünf Verbindungen (siehe
    `app/longpoll.py`). Das Gerät wird deshalb in JEDEM Versuch auf dessen
    eigener Sitzung neu geprüft — was nebenbei heißt, dass Sperren einen
    geparkten Poll beim nächsten Tick beendet.
    """
    token = bearer_token(authorization)
    with Session(db.engine) as s:  # db.engine spät — siehe app/longpoll.py
        uid = _check_device(s, token)
        before = changes_mod.decode(since)
        if not before:
            return AppChangeFeed(cursor=changes_mod.encode(_app_fingerprint(s, uid)))

    def attempt(session: Session) -> AppChangeFeed | None:
        _check_device(session, token)
        now = _app_fingerprint(session, uid)
        moved = changes_mod.changed(before, now)
        if not moved:
            return None
        return AppChangeFeed(cursor=changes_mod.encode(now), changed=moved)

    feed = await claim_with_wait(attempt, wait=wait)
    return feed if feed is not None else AppChangeFeed(cursor=changes_mod.encode(before))
