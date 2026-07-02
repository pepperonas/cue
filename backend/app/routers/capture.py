"""Prompt capture: ingest every CLI prompt (token-guarded) + owner-facing
session history (grouped by Claude session, attributed to a project)."""
from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, text
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import current_user_id, require_csrf, require_owner, require_runner
from ..models import (
    CapturedPrompt,
    CaptureSession,
    CliDelivery,
    DeliveryStatus,
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
    CaptureSettingsRead,
    CaptureSettingsUpdate,
    CliDeliveryRead,
    CliDeliveryResult,
    CliSendRequest,
    PromptRead,
)
from .prompts import _derive_title, _next_sort_order, _read

router = APIRouter(tags=["capture"])
_settings = get_settings()

# Deterministic project colors when auto-creating from a captured cwd.
_PALETTE = ["#6750A4", "#3B6EA5", "#2E7D55", "#B3541E", "#8E4585", "#0F766E", "#9A3B3B"]
_MAX_PROMPT = 20000
_MAX_SEND = 100000


def _transport_of(cs: CaptureSession) -> str | None:
    """Which terminal transport cue can use to reach this session, if any."""
    if cs.iterm_session_id:
        return "iterm"
    if cs.tmux_pane:
        return "tmux"
    return None


def _resolve_capture_user(session: Session, authorization: str | None) -> User:
    """Map a capture Bearer token to a user: the env CAPTURE_TOKEN → owner, or a
    per-user token → that user (multi-tenant)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing capture token")
    token = authorization[len("Bearer ") :]
    env = _settings.capture_token
    if env and hmac.compare_digest(token, env):
        email = _settings.owner_email
        user = (
            session.exec(select(User).where(func.lower(User.email) == email)).first()
            if email
            else session.exec(select(User)).first()
        )
        if not user:
            raise HTTPException(status_code=409, detail="Owner has not signed in yet")
        return user
    if token:
        user = session.exec(select(User).where(User.capture_token == token)).first()
        if user:
            return user
    raise HTTPException(status_code=401, detail="Invalid capture token")


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
    return CaptureSessionRead(
        **cs.model_dump(), project_name=name, deliverable=_transport_of(cs) is not None
    )


# ---- Ingest (token-guarded, from the runner's capture forwarder) ----
@router.post("/capture", response_model=CaptureResult)
def capture(
    payload: CaptureRequest,
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> CaptureResult:
    user = _resolve_capture_user(session, authorization)
    uid = user.id
    base = user.project_base or None
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
            name = _settings.capture_project_name(item.cwd, base)
            project = _project_for(session, uid, name) if name else None
            cs = CaptureSession(
                user_id=uid,
                claude_session_id=item.session_id,
                project_id=project.id if project else None,
                cwd=item.cwd or "",
            )
            session.add(cs)
            session.flush()
        # Refresh the live terminal context (the session may have moved panes).
        if item.term_program:
            cs.term_program = item.term_program
        if item.iterm_session_id:
            cs.iterm_session_id = item.iterm_session_id
        if item.tmux_pane:
            cs.tmux_pane = item.tmux_pane
        if item.tmux_socket:
            cs.tmux_socket = item.tmux_socket
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    cs = session.get(CaptureSession, session_pk)
    if not cs or cs.user_id != uid:
        raise HTTPException(status_code=404, detail="Session not found")
    for cp in session.exec(select(CapturedPrompt).where(CapturedPrompt.session_id == cs.id)).all():
        session.delete(cp)
    session.delete(cs)
    session.commit()


# ---- Per-user capture settings ----
@router.get("/capture/settings", response_model=CaptureSettingsRead)
def get_capture_settings(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> CaptureSettingsRead:
    user = session.get(User, uid)
    base = (user.project_base if user and user.project_base else _settings.capture_base) or ""
    return CaptureSettingsRead(project_base=base, has_token=bool(user and user.capture_token))


@router.post("/capture/settings", response_model=CaptureSettingsRead)
def update_capture_settings(
    payload: CaptureSettingsUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> CaptureSettingsRead:
    user = session.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.project_base is not None:
        user.project_base = payload.project_base.strip() or None
    token_once: str | None = None
    if payload.regenerate:
        token_once = secrets.token_hex(32)
        user.capture_token = token_once
    session.add(user)
    session.commit()
    base = (user.project_base or _settings.capture_base) or ""
    return CaptureSettingsRead(project_base=base, has_token=bool(user.capture_token), token=token_once)


# ---- Send a prompt back into a live session's terminal (owner-only) ----
@router.post("/sessions/{session_pk}/send", status_code=status.HTTP_201_CREATED)
def send_to_session(
    session_pk: int,
    payload: CliSendRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> dict:
    """Queue a delivery that the runner types into the session's terminal.

    Owner-only: this drives a terminal on the runner's machine, exactly like the
    run feature, so it must not be open to other allowlisted users."""
    cs = session.get(CaptureSession, session_pk)
    if not cs or cs.user_id != uid:
        raise HTTPException(status_code=404, detail="Session not found")
    txt = (payload.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Text required")
    if _transport_of(cs) is None:
        raise HTTPException(status_code=409, detail="Session has no reachable terminal")
    delivery = CliDelivery(
        user_id=uid, session_id=cs.id, text=txt[:_MAX_SEND], submit=bool(payload.submit)
    )
    session.add(delivery)
    session.commit()
    session.refresh(delivery)
    return {"id": delivery.id, "status": delivery.status}


# ---- Runner-facing (RUNNER_TOKEN) ----
# NB: declare the literal /cli/claim before /cli/{delivery_id}, or "claim" would
# be matched as the int path param and 422 before reaching this route.
@router.get("/cli/claim", response_model=CliDeliveryRead)
def claim_delivery(
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
):
    """Atomically claim the oldest queued delivery (single UPDATE guards against
    a double-claim if two poll ticks overlap)."""
    row = session.execute(
        text(
            "UPDATE cli_delivery SET status='sending' "
            "WHERE id = (SELECT id FROM cli_delivery WHERE status='queued' "
            "ORDER BY created_at, id LIMIT 1) AND status='queued' RETURNING id"
        )
    ).first()
    session.commit()
    if not row:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    d = session.get(CliDelivery, row[0])
    cs = session.get(CaptureSession, d.session_id)
    transport = _transport_of(cs) if cs else None
    if not cs or transport is None:
        d.status = DeliveryStatus.failed
        d.error = "session no longer reachable"
        d.sent_at = utcnow()
        session.add(d)
        session.commit()
        raise HTTPException(status_code=409, detail="Session no longer reachable")
    return CliDeliveryRead(
        id=d.id,
        transport=transport,
        iterm_session_id=cs.iterm_session_id,
        tmux_pane=cs.tmux_pane,
        tmux_socket=cs.tmux_socket,
        text=d.text,
        submit=d.submit,
    )


@router.post("/cli/{delivery_id}/result", status_code=status.HTTP_204_NO_CONTENT)
def delivery_result(
    delivery_id: int,
    payload: CliDeliveryResult,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> None:
    d = session.get(CliDelivery, delivery_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delivery not found")
    d.status = DeliveryStatus.sent if payload.status == "sent" else DeliveryStatus.failed
    d.error = (payload.error or None) if d.status == DeliveryStatus.failed else None
    d.sent_at = utcnow()
    session.add(d)
    session.commit()


@router.get("/cli/{delivery_id}")
def get_delivery(
    delivery_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> dict:
    d = session.get(CliDelivery, delivery_id)
    if not d or d.user_id != uid:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return {"id": d.id, "status": d.status, "error": d.error}
