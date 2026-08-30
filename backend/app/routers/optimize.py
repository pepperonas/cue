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
from ..deps import current_user_id, require_csrf, require_optimizer, require_runner
from ..longpoll import claim_with_wait
from ..models import OptimizationBatch, PromptOptimization, User
from ..optimization import (
    ExecutionResult,
    OptimizationError,
    PromptOptimizationService,
    providers,
)
from ..optimization import pricing
from .. import secrets_store
from ..optimization.meta_prompt import META_PROMPT_VERSION
from .prompts import _read as prompt_read
from ..schemas import (
    ApiKeyModel,
    ApiKeyStatus,
    ApiKeyUpdate,
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
#
# `require_optimizer` guards the two routes that SPEND money (queue one, queue
# a batch) and the config route, whose 403 is what hides the feature in the UI.
# Everything else — reading attempts, applying or discarding a finished
# proposal — is only tenant-scoped: removing your API key must not lock you out
# of results you already paid for, and deciding on one costs nothing.


@router.get("/config", response_model=OptimizationConfigRead)
def get_config(_owner: int = Depends(require_optimizer)) -> OptimizationConfigRead:
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


# ---------------------------------------------------- the user's own API key
#
# Reachable by every APPROVED user, deliberately not behind `require_optimizer`:
# storing a key is exactly how someone earns that permission, so gating it
# behind itself would leave every new user locked out of the feature forever.


@router.get("/key", response_model=ApiKeyStatus)
def get_api_key(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> ApiKeyStatus:
    user = session.get(User, uid)
    stored = secrets_store.decrypt(user.anthropic_key_enc) if user else None
    return ApiKeyStatus(
        configured=bool(stored),
        # A masked tail, never the key: a settings page that echoes back the
        # secret it stores turns every screenshot into a leak.
        preview=secrets_store.preview(stored),
        model=(user.optimize_model if user else None) or pricing.DEFAULT_MODEL,
        models=[
            ApiKeyModel(
                id=price.id,
                label=price.label,
                input_per_mtok=price.input_per_mtok,
                output_per_mtok=price.output_per_mtok,
            )
            for price in pricing.MODELS
        ],
        pricing_state=pricing.STATE,
    )


@router.put("/key", response_model=ApiKeyStatus)
def put_api_key(
    payload: ApiKeyUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> ApiKeyStatus:
    """Store (or replace) the caller's own Anthropic key.

    The key is verified against the API before it is saved. Without that check
    a typo is only discovered by the first optimization failing, minutes later
    and with a worse error — and a stored broken key silently switches the user
    off the working CLI path.
    """
    user = session.get(User, uid)
    if user is None:
        raise HTTPException(status_code=404, detail="Unknown user")

    if payload.model is not None:
        if payload.model and not pricing.is_known(payload.model):
            raise HTTPException(status_code=400, detail="Unbekanntes Modell")
        user.optimize_model = payload.model or None

    if payload.key is not None:
        key = payload.key.strip()
        if key:
            ok, detail = _verify_key(key)
            if not ok:
                raise HTTPException(status_code=400, detail=detail)
            user.anthropic_key_enc = secrets_store.encrypt(key)
        else:
            user.anthropic_key_enc = None
    session.add(user)
    session.commit()
    return get_api_key(session=session, uid=uid)


def _verify_key(key: str) -> tuple[bool, str]:
    """One cheap call that proves the key works, without spending real money."""
    try:
        import anthropic

        anthropic.Anthropic(api_key=key, max_retries=0, timeout=15.0).models.list(limit=1)
    except Exception as exc:  # noqa: BLE001 - every failure reads the same to the user
        status_code = getattr(exc, "status_code", None)
        if status_code in (401, 403):
            return False, "Der Key wurde von der API abgelehnt"
        return False, f"Key konnte nicht geprüft werden: {str(exc)[:180]}"
    return True, ""


@router.post("", response_model=OptimizationRead, status_code=status.HTTP_201_CREATED)
def create_optimization(
    payload: OptimizationCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(require_optimizer),
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
) -> OptimizationRead:
    job = _service(session).repo.get(optimization_id, uid)
    if job is None:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return _read(job)


@router.post("/{optimization_id}/cancel", response_model=OptimizationRead)
def cancel_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> OptimizationDecisionResult:
    """Take the proposal over into the prompt text."""
    return _decide(session, optimization_id, uid, apply=True)


@router.post("/{optimization_id}/discard", response_model=OptimizationDecisionResult)
def discard_optimization(
    optimization_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(require_optimizer),
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
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
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> OptimizationBatchRead:
    service = _service(session)
    try:
        batch = service.cancel_batch(batch_id, uid)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _batch_read(batch, service.repo.batch_counts(batch.id))


# -------------------------------------------------------------- runner routes


def _claim_optimization_once(
    session: Session, runner_id: str
) -> OptimizationClaimResponse | None:
    job = _service(session).claim(runner_id)
    return None if job is None else OptimizationClaimResponse(**job.__dict__)


@router.post("/claim", response_model=OptimizationClaimResponse)
async def claim_optimization(
    payload: OptimizationClaimRequest,
    wait: float = Query(
        0, ge=0, description="Seconds to hold the request open while the queue is empty."
    ),
    _runner: None = Depends(require_runner),
):
    """Hand out the next queued job (204 when the queue is empty).

    Returning a bare `Response` for the empty case mirrors `runs.claim` — a
    `None` body would trip the response-model validation. `?wait=N` long-polls;
    see `app.longpoll`.
    """
    job = await claim_with_wait(
        lambda s: _claim_optimization_once(s, (payload.runner_id or "runner")[:120]),
        wait=wait,
    )
    if job is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return job


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
