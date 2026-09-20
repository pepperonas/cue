"""Projekt-Analyse — HTTP-Hülle um `app.analysis`.

Zwei Publika, wie bei der Optimierung:

* **Nutzer-Endpunkte** (Cookie) hängen an `require_optimizer` — Eigentümer ODER
  jemand mit eigenem API-Key. Dieselbe Grenze wie die Optimierung, denn es ist
  dieselbe Frage: wer bezahlt den Lauf.
* **Runner-Endpunkte** sind allein durch den `RUNNER_TOKEN` gedeckt.

⚠️ Was hier bewusst FEHLT: Endpunkte zum Zusammenführen und zum Archivieren.
Beides läuft über die bestehenden Prompt-Routen, damit die Regeln (und die
Rückabwicklung eines Merges) nicht doppelt existieren.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session

from ..analysis.service import ProjectAnalysisService
from ..db import get_session
from ..deps import current_user_id, require_csrf, require_optimizer, require_runner
from ..longpoll import claim_with_wait
from ..models import ProjectAnalysis
from ..optimization import ExecutionResult, OptimizationError
from ..optimization.service import PromptOptimizationService
from ..schemas import (
    AnalysisClaimRequest,
    AnalysisClaimResponse,
    AnalysisCreate,
    AnalysisDecisionResult,
    AnalysisRead,
    AnalysisResult,
    OptimizationResultRequest,
)

router = APIRouter(prefix="/analyses", tags=["analyses"])


def _service(session: Session) -> ProjectAnalysisService:
    return ProjectAnalysisService(session)


def _fail(exc: OptimizationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _read(service: ProjectAnalysisService, lauf: ProjectAnalysis) -> AnalysisRead:
    try:
        anzahl = len(json.loads(lauf.subject_ids or "[]"))
    except (ValueError, TypeError):
        anzahl = 0
    ergebnis = None
    if lauf.result_json:
        from ..analysis import schema as vertrag

        analyse = service.ergebnis(lauf)
        if analyse is not None:
            ergebnis = AnalysisResult(**vertrag.als_dict(analyse))
    return AnalysisRead(
        id=lauf.id,
        project_id=lauf.project_id,
        project_name=lauf.project_name,
        status=lauf.status,
        decision=lauf.decision,
        provider=lauf.provider,
        model=lauf.model,
        prompt_version=lauf.prompt_version,
        prompt_count=anzahl,
        # Nur für einen fertigen, noch nicht entschiedenen Vorschlag relevant:
        # ein laufender Job hat noch nichts zu veralten.
        stale=service.veraltet(lauf) if lauf.result_json else False,
        duration_ms=lauf.duration_ms,
        cost_usd=lauf.cost_usd,
        input_tokens=lauf.input_tokens,
        output_tokens=lauf.output_tokens,
        error=lauf.error,
        result=ergebnis,
        created_at=lauf.created_at,
        started_at=lauf.started_at,
        finished_at=lauf.finished_at,
        decided_at=lauf.decided_at,
    )


# ------------------------------------------------------------------ Nutzer


@router.post("", response_model=AnalysisRead, status_code=status.HTTP_201_CREATED)
def create_analysis(
    payload: AnalysisCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _allowed: int = Depends(require_optimizer),
    _csrf: None = Depends(require_csrf),
) -> AnalysisRead:
    service = _service(session)
    try:
        # Wer bezahlt, entscheidet über den Weg — dieselbe eine Definition wie
        # bei der Optimierung, nicht eine zweite Ableitung daneben.
        provider = PromptOptimizationService(session).provider_for(uid)
        lauf = service.queue(uid, payload.project_id, provider=provider)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return _read(service, lauf)


@router.get("", response_model=list[AnalysisRead])
def list_analyses(
    project_id: int | None = Query(None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[AnalysisRead]:
    service = _service(session)
    return [_read(service, lauf) for lauf in service.list(uid, project_id)]


@router.get("/active", response_model=list[AnalysisRead])
def list_active(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[AnalysisRead]:
    """Was gerade läuft — treibt die Fortschrittsanzeige."""
    service = _service(session)
    return [_read(service, lauf) for lauf in service.aktive(uid)]


@router.get("/{analysis_id}", response_model=AnalysisRead)
def get_analysis(
    analysis_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> AnalysisRead:
    service = _service(session)
    try:
        return _read(service, service.get(uid, analysis_id))
    except OptimizationError as exc:
        raise _fail(exc) from exc


@router.post("/{analysis_id}/cancel", response_model=AnalysisRead)
def cancel_analysis(
    analysis_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AnalysisRead:
    service = _service(session)
    try:
        return _read(service, service.cancel(uid, analysis_id))
    except OptimizationError as exc:
        raise _fail(exc) from exc


@router.post("/{analysis_id}/apply", response_model=AnalysisDecisionResult)
def apply_analysis(
    analysis_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AnalysisDecisionResult:
    return _decide(session, uid, analysis_id, apply=True)


@router.post("/{analysis_id}/discard", response_model=AnalysisDecisionResult)
def discard_analysis(
    analysis_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AnalysisDecisionResult:
    return _decide(session, uid, analysis_id, apply=False)


def _decide(session: Session, uid: int, analysis_id: int, *, apply: bool):
    service = _service(session)
    try:
        lauf, geaendert = service.decide(uid, analysis_id, apply=apply)
    except OptimizationError as exc:
        raise _fail(exc) from exc
    return AnalysisDecisionResult(analysis=_read(service, lauf), geaendert=geaendert)


# ------------------------------------------------------------------ Runner


def _claim_once(session: Session, runner_id: str) -> AnalysisClaimResponse | None:
    job = _service(session).claim(runner_id)
    return None if job is None else AnalysisClaimResponse(**job.__dict__)


@router.post("/claim", response_model=AnalysisClaimResponse)
async def claim_analysis(
    payload: AnalysisClaimRequest,
    wait: float = Query(
        0, ge=0, description="Sekunden, die die Anfrage bei leerer Warteschlange offen bleibt."
    ),
    _runner: None = Depends(require_runner),
):
    """Den nächsten Job herausgeben (204 bei leerer Warteschlange)."""
    job = await claim_with_wait(
        lambda s: _claim_once(s, (payload.runner_id or "runner")[:120]), wait=wait
    )
    if job is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return job


@router.post("/{analysis_id}/result", response_model=AnalysisRead)
def report_result(
    analysis_id: int,
    payload: OptimizationResultRequest,
    session: Session = Depends(get_session),
    _runner: None = Depends(require_runner),
) -> AnalysisRead:
    """Ergebnis eines Ausführers.

    Teilt sich das Schema mit der Optimierung — der Ausführer liefert in beiden
    Fällen Text plus Telemetrie und kennt die Bedeutung nicht. Eine zweite,
    feldgleiche Klasse wäre nur eine weitere Stelle, die driften kann.
    """
    service = _service(session)
    try:
        lauf = service.complete(
            analysis_id,
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
    return _read(service, lauf)
