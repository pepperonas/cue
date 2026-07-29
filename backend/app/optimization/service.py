"""Prompt optimization business logic.

This is the only module that knows the RULES: who may optimize what, how a
version number is assigned, which text an attempt builds on, what happens to a
prompt when an attempt succeeds, and when a batch is finished. Controllers stay
thin, the repository stays dumb, and the actual CLI call happens far away in
the executing process (the Mac runner) behind a provider id.

Every attempt is logged with start/end, duration, exit code, model, prompt id
and outcome — the audit trail required for a feature that shells out.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlmodel import Session

from ..config import Settings, get_settings
from .. import events
from ..models import (
    OPTIMIZATION_TERMINAL,
    OptimizationBatch,
    OptimizationDecision,
    OptimizationStatus,
    Prompt,
    PromptEventType,
    PromptOptimization,
    utcnow,
)
from . import providers
from .meta_prompt import META_PROMPT_VERSION, build_meta_prompt, clean_result
from .repository import OptimizationRepository

log = logging.getLogger("cue.optimization")


class OptimizationError(Exception):
    """Business-rule violation — mapped to a 4xx by the router."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class ClaimedJob:
    """What an executor needs — and nothing more (no DB objects leave here)."""

    id: int
    provider: str
    model: str
    prompt: str
    timeout_s: int
    max_chars: int
    max_retries: int
    prompt_id: int
    version: int


@dataclass(frozen=True)
class ExecutionResult:
    """What an executor reports back."""

    status: str
    optimized_text: str | None = None
    model: str = ""
    exit_code: int | None = None
    duration_ms: int | None = None
    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


class PromptOptimizationService:
    """Orchestrates optimization jobs, batches and their persistence."""

    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.repo = OptimizationRepository(session)
        self.session = session
        self.settings = settings or get_settings()

    # ---- queueing ----------------------------------------------------------
    def queue(
        self,
        prompt_id: int,
        uid: int,
        *,
        provider: str | None = None,
        batch_id: str | None = None,
    ) -> PromptOptimization:
        """Queue one optimization for a prompt (v1 or a refinement)."""
        if not self.settings.optimize_enabled:
            raise OptimizationError("Prompt-Optimierung ist deaktiviert", 503)

        prompt = self.repo.owned_prompt(prompt_id, uid)
        if prompt is None:
            raise OptimizationError("Prompt not found", 404)
        return self._queue_for(prompt, uid, provider=provider, batch_id=batch_id)

    def _queue_for(
        self,
        prompt: Prompt,
        uid: int,
        *,
        provider: str | None,
        batch_id: str | None,
    ) -> PromptOptimization:
        body = (prompt.body or "").strip()
        if not body:
            raise OptimizationError("Prompt hat keinen Text", 400)
        if len(body) > self.settings.optimize_max_chars:
            raise OptimizationError(
                f"Prompt ist zu lang ({len(body)} Zeichen, erlaubt sind "
                f"{self.settings.optimize_max_chars})",
                413,
            )
        if self.repo.active_for_prompt(prompt.id, uid) is not None:
            raise OptimizationError("Für diesen Prompt läuft bereits eine Optimierung", 409)

        spec = providers.get(provider or self.settings.optimize_provider)
        previous = self.repo.latest_successful(prompt.id, uid)
        job = PromptOptimization(
            user_id=uid,
            prompt_id=prompt.id,
            batch_id=batch_id,
            version=self.repo.next_version(prompt.id, uid),
            status=OptimizationStatus.queued,
            provider=spec.id,
            model=self.settings.optimize_model or spec.default_model,
            meta_prompt_version=META_PROMPT_VERSION,
            # Bookmarks are the reusable shelf: rewrite them to fit any project
            # instead of only sharpening them for the one they came from.
            universal=bool(prompt.bookmarked),
            original_text=body,
            previous_text=previous.optimized_text if previous else None,
        )
        job = self.repo.add(job)
        log.info(
            "optimization queued id=%s prompt=%s version=%s provider=%s batch=%s mode=%s",
            job.id,
            job.prompt_id,
            job.version,
            job.provider,
            batch_id or "-",
            "universal" if job.universal else "standard",
        )
        return job

    def start_batch(
        self,
        uid: int,
        *,
        project_id: int | None = None,
        only_pending: bool = True,
        provider: str | None = None,
    ) -> tuple[OptimizationBatch, int, int]:
        """Queue every eligible prompt as one sequential batch.

        Returns (batch, queued, skipped). Prompts that cannot be queued (empty,
        too long, already running) are skipped instead of failing the batch —
        the requirement is "skip broken ones and report at the end".
        """
        if self.repo.active_batch(uid) is not None:
            raise OptimizationError("Es läuft bereits eine Sammel-Optimierung", 409)

        spec = providers.get(provider or self.settings.optimize_provider)
        candidates = self.repo.prompts_for_batch(uid, project_id=project_id, only_pending=only_pending)
        if not candidates:
            raise OptimizationError("Keine Prompts zum Optimieren gefunden", 400)

        batch = self.repo.add_batch(
            OptimizationBatch(user_id=uid, provider=spec.id, total=0)
        )
        queued = skipped = 0
        for prompt in candidates:
            try:
                self._queue_for(prompt, uid, provider=spec.id, batch_id=batch.id)
                queued += 1
            except OptimizationError as exc:
                skipped += 1
                log.info("batch %s skips prompt %s: %s", batch.id, prompt.id, exc.message)
        batch.total = queued
        if queued == 0:
            batch.finished_at = utcnow()
        self.session.add(batch)
        self.session.commit()
        self.session.refresh(batch)
        log.info("batch %s started: %s queued, %s skipped", batch.id, queued, skipped)
        return batch, queued, skipped

    # ---- execution handshake ----------------------------------------------
    def claim(self, runner_id: str) -> ClaimedJob | None:
        """Hand the next queued job to an executor (atomic, one at a time)."""
        job = self.repo.claim_next(runner_id)
        if job is None:
            return None
        log.info(
            "optimization claimed id=%s prompt=%s by=%s", job.id, job.prompt_id, runner_id
        )
        return ClaimedJob(
            id=job.id,
            provider=job.provider,
            model=job.model,
            prompt=build_meta_prompt(
                job.original_text, job.previous_text, universal=job.universal
            ),
            timeout_s=self.settings.optimize_timeout,
            max_chars=self.settings.optimize_max_chars,
            max_retries=self.settings.optimize_max_retries,
            prompt_id=job.prompt_id,
            version=job.version,
        )

    def complete(self, optimization_id: int, result: ExecutionResult) -> PromptOptimization:
        """Record an executor's outcome and apply it to the prompt."""
        job = self.session.get(PromptOptimization, optimization_id)
        if job is None:
            raise OptimizationError("Optimization not found", 404)
        if job.status in OPTIMIZATION_TERMINAL:
            # Late report after a cancel/reap: keep the terminal state.
            return job

        now = utcnow()
        text = clean_result(result.optimized_text or "")
        status = OptimizationStatus(result.status)
        if status == OptimizationStatus.succeeded and not text:
            status = OptimizationStatus.failed
            job.error = "Optimierung lieferte keinen Text zurück"
        else:
            job.error = (result.error or None) if status != OptimizationStatus.succeeded else None

        job.status = status
        job.optimized_text = text or None
        job.model = result.model or job.model
        job.exit_code = result.exit_code
        job.duration_ms = result.duration_ms or self._elapsed_ms(job, now)
        job.cost_usd = result.cost_usd
        job.input_tokens = result.input_tokens
        job.output_tokens = result.output_tokens
        job.finished_at = now
        self.session.add(job)

        if status == OptimizationStatus.succeeded:
            self._apply_to_prompt(job, now)
        self.session.commit()
        self.session.refresh(job)
        self._finish_batch_if_done(job)

        log.info(
            "optimization %s id=%s prompt=%s version=%s model=%s exit=%s duration=%sms cost=%s%s",
            job.status.value,
            job.id,
            job.prompt_id,
            job.version,
            job.model or "-",
            job.exit_code,
            job.duration_ms,
            job.cost_usd,
            f" error={job.error}" if job.error else "",
        )
        return job

    def _elapsed_ms(self, job: PromptOptimization, now) -> int | None:  # noqa: ANN001
        if job.started_at is None:
            return None
        started = job.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=now.tzinfo)
        return int((now - started).total_seconds() * 1000)

    def _apply_to_prompt(self, job: PromptOptimization, now) -> None:  # noqa: ANN001
        """Store the result BESIDE the original — `Prompt.body` is never touched."""
        prompt = self.session.get(Prompt, job.prompt_id)
        if prompt is None:
            return
        prompt.optimized = True
        prompt.optimized_body = job.optimized_text
        prompt.optimized_at = now
        prompt.optimization_model = job.model or providers.get(job.provider).label
        prompt.optimization_version = job.version
        self.session.add(prompt)

    # ---- review ------------------------------------------------------------
    def decide(
        self, optimization_id: int, uid: int, *, apply: bool
    ) -> tuple[PromptOptimization, Prompt]:
        """Take the result over into the prompt, or drop it.

        A finished optimization is a PROPOSAL: nothing replaces the prompt text
        until this is called. Applying copies the text into `Prompt.body`;
        either way the pending state is cleared and the decision is recorded on
        the attempt, so the history says which version was taken.
        """
        job = self.repo.get(optimization_id, uid)
        if job is None:
            raise OptimizationError("Optimierung nicht gefunden", 404)
        if job.status is not OptimizationStatus.succeeded:
            raise OptimizationError("Nur erfolgreiche Optimierungen können übernommen werden", 400)
        if job.decision is not OptimizationDecision.pending:
            raise OptimizationError("Über diese Optimierung wurde bereits entschieden", 409)

        prompt = self.session.get(Prompt, job.prompt_id)
        if prompt is None or prompt.user_id != uid:
            raise OptimizationError("Prompt not found", 404)

        now = utcnow()
        job.decision = OptimizationDecision.applied if apply else OptimizationDecision.discarded
        job.decided_at = now
        self.session.add(job)

        if apply:
            prompt.body = job.optimized_text or prompt.body
            prompt.updated_at = now
            events.record(self.session, prompt, PromptEventType.updated)
        # Pending state is cleared either way: the proposal has been reviewed.
        prompt.optimized = False
        prompt.optimized_body = None
        self.session.add(prompt)
        self.session.commit()
        self.session.refresh(job)
        self.session.refresh(prompt)
        log.info(
            "optimization %s %s for prompt %s",
            job.id,
            "applied" if apply else "discarded",
            job.prompt_id,
        )
        return job, prompt

    def _finish_batch_if_done(self, job: PromptOptimization) -> None:
        if not job.batch_id:
            return
        batch = self.session.get(OptimizationBatch, job.batch_id)
        if batch is None or batch.finished_at is not None:
            return
        counts = self.repo.batch_counts(batch.id)
        if counts["pending"] == 0:
            batch.finished_at = utcnow()
            self.session.add(batch)
            self.session.commit()
            log.info(
                "batch %s finished: %s succeeded, %s failed",
                batch.id,
                counts["done"],
                counts["failed"],
            )

    # ---- cancelling & housekeeping ----------------------------------------
    def cancel(self, optimization_id: int, uid: int) -> PromptOptimization:
        job = self.repo.get(optimization_id, uid)
        if job is None:
            raise OptimizationError("Optimization not found", 404)
        if job.status in OPTIMIZATION_TERMINAL:
            return job
        job.status = OptimizationStatus.canceled
        job.finished_at = utcnow()
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        self._finish_batch_if_done(job)
        return job

    def cancel_batch(self, batch_id: str, uid: int) -> OptimizationBatch:
        """Stop a batch: queued jobs are canceled, a running one finishes."""
        batch = self.repo.get_batch(batch_id, uid)
        if batch is None:
            raise OptimizationError("Batch not found", 404)
        batch.canceled = True
        now = utcnow()
        pending = 0
        for job in self.repo.batch_jobs(batch.id):
            if job.status == OptimizationStatus.queued:
                job.status = OptimizationStatus.canceled
                job.finished_at = now
                self.session.add(job)
            elif job.status == OptimizationStatus.running:
                pending += 1
        if pending == 0:
            batch.finished_at = now
        self.session.add(batch)
        self.session.commit()
        self.session.refresh(batch)
        log.info("batch %s canceled (%s still running)", batch.id, pending)
        return batch

    def reap_stale(self) -> int:
        """Fail jobs whose executor vanished (also cleans up after a restart)."""
        cutoff = utcnow() - timedelta(
            seconds=self.settings.optimize_timeout + self.settings.optimize_stale_grace
        )
        cutoff_naive = cutoff.replace(tzinfo=None)
        stale = self.repo.stale_running(cutoff_naive)
        for job in stale:
            job.status = OptimizationStatus.failed
            job.error = "Runner hat kein Ergebnis geliefert (Timeout)"
            job.finished_at = utcnow()
            self.session.add(job)
            log.warning("optimization %s reaped as stale (prompt %s)", job.id, job.prompt_id)
        if stale:
            self.session.commit()
            for job in stale:
                self._finish_batch_if_done(job)
        return len(stale)
