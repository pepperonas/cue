"""Prompt-optimization endpoints — HTTP shell around `app.optimization`.

No business logic lives here: the router authenticates, translates payloads and
serializes results. Everything else is `PromptOptimizationService`.

Two audiences, exactly like the run engine:
* **User endpoints** (cookie auth) are **owner-only** — an optimization runs the
  Claude Code CLI on the runner's machine, so it must not be open to every
  allowlisted user.
* **Runner endpoints** are guarded solely by the `RUNNER_TOKEN` bearer.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session

from ..config import get_settings
from ..db import get_session
from ..deps import current_user_id, require_csrf, require_owner, require_runner
from ..models import OptimizationBatch, PromptOptimization
from ..optimization import (
    ExecutionResult,
    OptimizationError,
    PromptOptimizationService,
    providers,
)
from ..optimization.meta_prompt import META_PROMPT_VERSION
from .prompts import _read as prompt_read
from ..schemas import (
    OptimizationBatchCreate,
    OptimizationBatchRead,
    OptimizationClaimRequest,
    OptimizationClaimResponse,
    OptimizationConfigRead,
    OptimizationDecisionResult,
    OptimizationCreate,
    OptimizationProviderRead,
    OptimizationRead,
    OptimizationResultRequest,
)

router = APIRouter(prefix="/optimizations", tags=["optimizations"])
_settings = get_settings()


def _service(session: Session) -> PromptOptimizationService:
    return PromptOptimizationService(session, _settings)


def _read(job: PromptOptimization) -> OptimizationRead:
    return OptimizationRead(**job.model_dump())


def _batch_read(batch: OptimizationBatch, counts: dict[str, int]) -> OptimizationBatchRead:
    return OptimizationBatchRead(
        id=batch.id,
        provider=batch.provider,
        total=batch.total,
        done=counts["done"],
        failed=counts["failed"],
        pending=counts["pending"],
        canceled=batch.canceled,
        created_at=batch.created_at,
        finished_at=batch.finished_at,
    )


def _fail(exc: OptimizationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


# ---------------------------------------------------------------- user routes


@router.get("/config", response_model=OptimizationConfigRead)
def get_config(_owner: int = Depends(require_owner)) -> OptimizationConfigRead:
    """Capabilities + limits. A 403 here is what hides the feature in the UI."""
    return OptimizationConfigRead(
        enabled=_settings.optimize_enabled,
        default_provider=providers.get(_settings.optimize_provider).id,
        providers=[
            OptimizationProviderRead(
                id=spec.id, label=spec.label, description=spec.description, executed_by=spec.executed_by
            )
            for spec in providers.available()
        ],
        timeout_s=_settings.optimize_timeout,
        max_chars=_settings.optimize_max_chars,
        meta_prompt_version=META_PROMPT_VERSION,
    )


@router.post("", response_model=OptimizationRead, status_code=status.HTTP_201_CREATED)
def create_optimization(
    payload: OptimizationCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationRead:
    """Queue an optimization (first run or refinement) for one prompt."""
    try:
        job = _service(session).queue(payload.prompt_id, uid, provider=payload.provider)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _read(job)


@router.get("", response_model=list[OptimizationRead])
def list_optimizations(
    prompt_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> list[OptimizationRead]:
    """Version history for a prompt, or every currently active job."""
    service = _service(session)
    rows = (
        service.repo.history(prompt_id, uid)
        if prompt_id is not None
        else service.repo.list_active(uid)
    )
    return [_read(row) for row in rows]


@router.get("/{optimization_id}", response_model=OptimizationRead)
def get_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> OptimizationRead:
    job = _service(session).repo.get(optimization_id, uid)
    if job is None:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return _read(job)


@router.post("/{optimization_id}/cancel", response_model=OptimizationRead)
def cancel_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationRead:
    try:
        return _read(_service(session).cancel(optimization_id, uid))
    except OptimizationError as exc:
        raise _fail(exc) from exc


@router.post("/{optimization_id}/apply", response_model=OptimizationDecisionResult)
def apply_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationDecisionResult:
    """Take the proposal over into the prompt text."""
    return _decide(session, optimization_id, uid, apply=True)


@router.post("/{optimization_id}/discard", response_model=OptimizationDecisionResult)
def discard_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationDecisionResult:
    """Drop the proposal; the prompt text stays as it is."""
    return _decide(session, optimization_id, uid, apply=False)


def _decide(
    session: Session, optimization_id: int, uid: int, *, apply: bool
) -> OptimizationDecisionResult:
    try:
        job, prompt = _service(session).decide(optimization_id, uid, apply=apply)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    # The prompt travels back so the client can drop the pending state without
    # a second round trip.
    return OptimizationDecisionResult(optimization=_read(job), prompt=prompt_read(session, prompt))


@router.post("/batch", response_model=OptimizationBatchRead, status_code=status.HTTP_201_CREATED)
def create_batch(
    payload: OptimizationBatchCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationBatchRead:
    """Queue every eligible prompt; the runner works them off one by one."""
    service = _service(session)
    try:
        batch, _queued, _skipped = service.start_batch(
            uid,
            project_id=payload.project_id,
            only_pending=payload.only_pending,
            provider=payload.provider,
        )
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _batch_read(batch, service.repo.batch_counts(batch.id))


@router.get("/batch/active", response_model=OptimizationBatchRead | None)
def get_active_batch(
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> OptimizationBatchRead | None:
    """Progress of the running batch (null when none is active)."""
    service = _service(session)
    batch = service.repo.active_batch(uid)
    if batch is None:
        return None
    return _batch_read(batch, service.repo.batch_counts(batch.id))


@router.get("/batch/{batch_id}", response_model=OptimizationBatchRead)
def get_batch(
    batch_id: str,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
) -> OptimizationBatchRead:
    service = _service(session)
    batch = service.repo.get_batch(batch_id, uid)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _batch_read(batch, service.repo.batch_counts(batch.id))


@router.post("/batch/{batch_id}/cancel", response_model=OptimizationBatchRead)
def cancel_batch(
    batch_id: str,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> OptimizationBatchRead:
    service = _service(session)
    try:
        batch = service.cancel_batch(batch_id, uid)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _batch_read(batch, service.repo.batch_counts(batch.id))


# -------------------------------------------------------------- runner routes


@router.post("/claim", response_model=OptimizationClaimResponse)
def claim_optimization(
    payload: OptimizationClaimRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
):
    """Hand out the next queued job (204 when the queue is empty).

    Returning a bare `Response` for the empty case mirrors `runs.claim` — a
    `None` body would trip the response-model validation."""
    job = _service(session).claim((payload.runner_id or "runner")[:120])
    if job is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return OptimizationClaimResponse(**job.__dict__)


@router.post("/{optimization_id}/result", response_model=OptimizationRead)
def report_result(
    optimization_id: int,
    payload: OptimizationResultRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> OptimizationRead:
    """Executor reports an outcome; the service applies it to the prompt."""
    try:
        job = _service(session).complete(
            optimization_id,
            ExecutionResult(
                status=payload.status.value,
                optimized_text=payload.optimized_text,
                model=payload.model,
                exit_code=payload.exit_code,
                duration_ms=payload.duration_ms,
                cost_usd=payload.cost_usd,
                input_tokens=payload.input_tokens,
                output_tokens=payload.output_tokens,
                error=payload.error,
            ),
        )
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _read(job)
