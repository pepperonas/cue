"""Prompt capture: ingest every CLI prompt (token-guarded) + owner-facing
session history (grouped by Claude session, attributed to a project)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import require_capture, require_csrf, require_owner
from ..models import (
    CapturedPrompt,
    CaptureSession,
    Project,
    Prompt,
    PromptStatus,
    User,
    utcnow,
)
from ..schemas import (
    CaptureRequest,
    CaptureResult,
    CaptureSessionDetail,
    CaptureSessionRead,
    PromptRead,
)
from .prompts import _derive_title, _next_sort_order, _read

router = APIRouter(tags=["capture"])
_settings = get_settings()

# Deterministic project colors when auto-creating from a captured cwd.
_PALETTE = ["#6750A4", "#3B6EA5", "#2E7D55", "#B3541E", "#8E4585", "#0F766E", "#9A3B3B"]
_MAX_PROMPT = 20000


def _owner_user(session: Session) -> User:
    """The user captures are attributed to (single-owner for now)."""
    email = _settings.owner_email
    user = (
        session.exec(select(User).where(func.lower(User.email) == email)).first()
        if email
        else session.exec(select(User)).first()
    )
    if not user:
        raise HTTPException(status_code=409, detail="Owner has not signed in yet")
    return user


def _project_for(session: Session, uid: int, name: str) -> Project:
    existing = session.exec(
        select(Project).where(Project.user_id == uid, Project.name == name)
    ).first()
    if existing:
        return existing
    next_order = (
        session.exec(select(func.max(Project.sort_order)).where(Project.user_id == uid)).one() or 0
    ) + 1
    project = Project(
        user_id=uid,
        name=name,
        color=_PALETTE[sum(map(ord, name)) % len(_PALETTE)],
        sort_order=next_order,
    )
    session.add(project)
    session.flush()
    return project


def _session_read(session: Session, cs: CaptureSession) -> CaptureSessionRead:
    name = None
    if cs.project_id:
        project = session.get(Project, cs.project_id)
        name = project.name if project else None
    return CaptureSessionRead(**cs.model_dump(), project_name=name)


# ---- Ingest (token-guarded, from the runner's capture forwarder) ----
@router.post("/capture", response_model=CaptureResult)
def capture(
    payload: CaptureRequest,
    session: Session = Depends(get_session),
    _cap: None = Depends(require_capture),
) -> CaptureResult:
    user = _owner_user(session)
    uid = user.id
    stored = skipped = 0
    # Cache sessions within this batch to avoid repeated lookups.
    cache: dict[str, CaptureSession] = {}

    for item in payload.items:
        text = (item.prompt or "").strip()
        if not text:
            skipped += 1
            continue
        cs = cache.get(item.session_id)
        if cs is None:
            cs = session.exec(
                select(CaptureSession).where(
                    CaptureSession.user_id == uid,
                    CaptureSession.claude_session_id == item.session_id,
                )
            ).first()
        if cs is None:
            name = _settings.capture_project_name(item.cwd)
            project = _project_for(session, uid, name) if name else None
            cs = CaptureSession(
                user_id=uid,
                claude_session_id=item.session_id,
                project_id=project.id if project else None,
                cwd=item.cwd or "",
            )
            session.add(cs)
            session.flush()
        cache[item.session_id] = cs

        # Dedup on (session, seq) when the client provides a sequence.
        if item.seq > 0:
            dup = session.exec(
                select(CapturedPrompt.id).where(
                    CapturedPrompt.session_id == cs.id, CapturedPrompt.seq == item.seq
                )
            ).first()
            if dup:
                skipped += 1
                continue
        created = (
            datetime.fromtimestamp(item.ts, tz=timezone.utc) if item.ts else utcnow()
        )
        session.add(
            CapturedPrompt(
                session_id=cs.id,
                user_id=uid,
                seq=item.seq,
                text=text[:_MAX_PROMPT],
                created_at=created,
            )
        )
        cs.prompt_count += 1
        cs.last_at = utcnow()
        session.add(cs)
        stored += 1

    session.commit()
    return CaptureResult(stored=stored, skipped=skipped)


# ---- Owner-facing history ----
@router.get("/sessions", response_model=list[CaptureSessionRead])
def list_sessions(
    project_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> list[CaptureSessionRead]:
    stmt = select(CaptureSession).where(CaptureSession.user_id == uid)
    if project_id is not None:
        stmt = stmt.where(CaptureSession.project_id == project_id)
    stmt = stmt.order_by(CaptureSession.last_at.desc(), CaptureSession.id.desc())
    return [_session_read(session, cs) for cs in session.exec(stmt).all()]


@router.get("/sessions/{session_pk}", response_model=CaptureSessionDetail)
def get_session_detail(
    session_pk: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> CaptureSessionDetail:
    cs = session.get(CaptureSession, session_pk)
    if not cs or cs.user_id != uid:
        raise HTTPException(status_code=404, detail="Session not found")
    prompts = session.exec(
        select(CapturedPrompt)
        .where(CapturedPrompt.session_id == cs.id)
        .order_by(CapturedPrompt.seq, CapturedPrompt.id)
    ).all()
    base = _session_read(session, cs)
    return CaptureSessionDetail(**base.model_dump(), prompts=[p.model_dump() for p in prompts])


@router.post(
    "/sessions/{session_pk}/prompts/{cp_id}/promote",
    response_model=PromptRead,
    status_code=status.HTTP_201_CREATED,
)
def promote_captured(
    session_pk: int,
    cp_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> PromptRead:
    """Turn a captured prompt into a real (queued) prompt in the session's project."""
    cs = session.get(CaptureSession, session_pk)
    if not cs or cs.user_id != uid:
        raise HTTPException(status_code=404, detail="Session not found")
    cp = session.get(CapturedPrompt, cp_id)
    if not cp or cp.session_id != cs.id:
        raise HTTPException(status_code=404, detail="Captured prompt not found")
    prompt = Prompt(
        user_id=uid,
        title=_derive_title("", cp.text),
        body=cp.text,
        project_id=cs.project_id,
        status=PromptStatus.queued,
        sort_order=_next_sort_order(session, PromptStatus.queued, uid),
    )
    session.add(prompt)
    session.commit()
    session.refresh(prompt)
    return _read(session, prompt)


@router.delete("/sessions/{session_pk}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_pk: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> None:
    cs = session.get(CaptureSession, session_pk)
    if not cs or cs.user_id != uid:
        raise HTTPException(status_code=404, detail="Session not found")
    for cp in session.exec(select(CapturedPrompt).where(CapturedPrompt.session_id == cs.id)).all():
        session.delete(cp)
    session.delete(cs)
    session.commit()
