"""Run engine: user-facing run management + runner-facing claim/report endpoints.

User endpoints use the existing session-cookie auth and are restricted to the
owner (`require_owner`); mutations also require CSRF. Runner endpoints are
guarded solely by the shared RUNNER_TOKEN (`require_runner`).
"""
from __future__ import annotations

from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, text
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import require_csrf, require_owner, require_runner
from ..models import (
    Prompt,
    Run,
    RunKind,
    RunLog,
    RunStatus,
    RunStep,
    RUN_TERMINAL,
    utcnow,
)
from ..schemas import (
    ClaimRequest,
    HeartbeatResponse,
    RunConfigRead,
    RunCreate,
    RunDetailRead,
    RunLogAppend,
    RunRead,
    RunResultRequest,
    StepResultRequest,
)

router = APIRouter(prefix="/runs", tags=["runs"])
_settings = get_settings()

_PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]
_MODELS = ["sonnet", "opus", "opusplan", "haiku"]
_MAX_LINE = 4096


def _run_read(run: Run) -> RunRead:
    return RunRead(**run.model_dump())


def _run_detail(session: Session, run: Run, after_seq: int = 0) -> RunDetailRead:
    steps = session.exec(
        select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.step_index)
    ).all()
    logs = session.exec(
        select(RunLog)
        .where(RunLog.run_id == run.id, RunLog.seq > after_seq)
        .order_by(RunLog.seq)
    ).all()
    return RunDetailRead(
        **run.model_dump(),
        steps=[s.model_dump() for s in steps],
        logs=[lg.model_dump() for lg in logs],
    )


def _owned_run(session: Session, run_id: str, uid: int) -> Run:
    run = session.get(Run, run_id)
    if not run or run.user_id != uid:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def reap_stale(session: Session, timeout_seconds: int) -> int:
    """Fail runs stuck in claiming/running without a recent heartbeat (the runner
    died/restarted). Runs at startup and periodically. Returns the count reaped."""
    now = utcnow()
    cutoff = now - timedelta(seconds=timeout_seconds)
    stale = session.exec(
        select(Run).where(Run.status.in_((RunStatus.claiming, RunStatus.running)))
    ).all()
    reaped = 0
    for run in stale:
        ref = run.last_heartbeat or run.started_at or run.created_at
        if ref is None:
            continue
        if ref.tzinfo is None:
            ref = ref.replace(tzinfo=timezone.utc)
        if ref >= cutoff:
            continue  # still fresh
        run.status = RunStatus.failed
        run.error = "runner timeout"
        run.finished_at = now
        session.add(run)
        for step in session.exec(select(RunStep).where(RunStep.run_id == run.id)).all():
            if step.status not in RUN_TERMINAL:
                step.status = RunStatus.failed
                step.finished_at = now
                session.add(step)
        reaped += 1
    if reaped:
        session.commit()
    return reaped


# ---- User-facing ----
@router.get("/config", response_model=RunConfigRead)
def run_config(_uid: int = Depends(require_owner)) -> RunConfigRead:
    return RunConfigRead(
        allowed_bases=_settings.allowed_project_bases,
        permission_modes=_PERMISSION_MODES,
        models=_MODELS,
    )


@router.post("", response_model=RunRead, status_code=status.HTTP_201_CREATED)
def create_run(
    payload: RunCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> RunRead:
    ids = payload.prompt_ids
    if not ids:
        raise HTTPException(status_code=400, detail="At least one prompt is required")
    if payload.kind == RunKind.single and len(ids) != 1:
        raise HTTPException(status_code=400, detail="A single run takes exactly one prompt")
    if payload.kind == RunKind.chain and len(ids) < 2:
        raise HTTPException(status_code=400, detail="A chain needs at least two prompts")
    if not _settings.is_path_allowed(payload.project_path):
        raise HTTPException(status_code=400, detail="project_path is not allowed")

    run = Run(
        user_id=uid,
        kind=payload.kind,
        project_path=payload.project_path,
        model=payload.model,
        allowed_tools=payload.allowed_tools,
        permission_mode=payload.permission_mode,
        bare=payload.bare,
        skip_permissions=payload.skip_permissions,
        max_turns=payload.max_turns,
        stop_on_error=payload.stop_on_error,
    )
    session.add(run)
    session.flush()  # assign run.id

    for idx, pid in enumerate(ids):
        prompt = session.get(Prompt, pid)
        if not prompt or prompt.user_id != uid:
            raise HTTPException(status_code=400, detail="Unknown prompt")
        session.add(
            RunStep(run_id=run.id, step_index=idx, prompt_id=pid, prompt_text=prompt.body)
        )
    session.commit()
    session.refresh(run)
    return _run_read(run)


@router.get("", response_model=list[RunRead])
def list_runs(
    status_filter: RunStatus | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> list[RunRead]:
    stmt = select(Run).where(Run.user_id == uid)
    if status_filter is not None:
        stmt = stmt.where(Run.status == status_filter)
    stmt = stmt.order_by(Run.created_at.desc(), Run.id)
    return [_run_read(r) for r in session.exec(stmt).all()]


@router.get("/{run_id}", response_model=RunDetailRead)
def get_run(
    run_id: str,
    after_seq: int = Query(default=0),
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> RunDetailRead:
    return _run_detail(session, _owned_run(session, run_id, uid), after_seq=after_seq)


@router.post("/{run_id}/cancel", response_model=RunRead)
def cancel_run(
    run_id: str,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> RunRead:
    run = _owned_run(session, run_id, uid)
    if run.status == RunStatus.queued:
        run.status = RunStatus.canceled
        run.finished_at = utcnow()
    elif run.status in (RunStatus.claiming, RunStatus.running):
        run.cancel_requested = True
    # terminal -> no-op
    session.add(run)
    session.commit()
    session.refresh(run)
    return _run_read(run)


# ---- Runner-facing ----
@router.post("/claim", response_model=RunDetailRead)
def claim_run(
    payload: ClaimRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
):
    """Atomically claim the oldest queued run (single UPDATE guards against
    double-claiming when several runners poll concurrently)."""
    runner_id = (payload.runner_id or "runner")[:120]
    now = utcnow()
    row = session.execute(
        text(
            "UPDATE run SET status='claiming', runner_id=:rid, started_at=:now, "
            "last_heartbeat=:now "
            "WHERE id = (SELECT id FROM run WHERE status='queued' "
            "ORDER BY created_at, id LIMIT 1) AND status='queued' RETURNING id"
        ),
        {"rid": runner_id, "now": now},
    ).first()
    session.commit()
    if not row:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    run = session.get(Run, row[0])
    return _run_detail(session, run)


@router.post("/{run_id}/heartbeat", response_model=HeartbeatResponse)
def heartbeat(
    run_id: str,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> HeartbeatResponse:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in RUN_TERMINAL:
        run.last_heartbeat = utcnow()
        if run.status == RunStatus.claiming:
            run.status = RunStatus.running
        session.add(run)
        session.commit()
    return HeartbeatResponse(status=run.status, cancel_requested=run.cancel_requested)


@router.post("/{run_id}/log")
def append_log(
    run_id: str,
    payload: RunLogAppend,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> dict:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    base = session.exec(select(func.max(RunLog.seq)).where(RunLog.run_id == run_id)).one() or 0
    for i, line in enumerate(payload.lines, start=1):
        session.add(
            RunLog(
                run_id=run_id,
                step_index=payload.step_index,
                seq=base + i,
                event_type=(line.event_type or "")[:64],
                line=(line.line or "")[:_MAX_LINE],
            )
        )
    session.commit()
    return {"ok": True}


@router.post("/{run_id}/steps/{idx}/result")
def step_result(
    run_id: str,
    idx: int,
    payload: StepResultRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> dict:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    step = session.exec(
        select(RunStep).where(RunStep.run_id == run_id, RunStep.step_index == idx)
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    now = utcnow()
    step.status = payload.status
    if payload.claude_session_id:
        step.claude_session_id = payload.claude_session_id
        if not run.claude_session_id:
            run.claude_session_id = payload.claude_session_id
            session.add(run)
    if payload.output is not None:
        step.output = payload.output
    step.exit_code = payload.exit_code
    step.cost_usd = payload.cost_usd
    if step.started_at is None:
        step.started_at = now
    step.finished_at = now
    session.add(step)
    session.commit()
    return {"ok": True}


@router.post("/{run_id}/result", response_model=RunRead)
def run_result(
    run_id: str,
    payload: RunResultRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> RunRead:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.status = payload.status
    run.total_cost_usd = payload.total_cost_usd
    run.error = (payload.error or None) and payload.error[:2000]
    run.finished_at = utcnow()
    session.add(run)
    session.commit()
    session.refresh(run)
    return _run_read(run)
