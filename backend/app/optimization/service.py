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

from sqlmodel import Session, select

from ..config import Settings, get_settings
from ..tags import TagService
from .. import events
from ..models import (
    OPTIMIZATION_TERMINAL,
    OptimizationBatch,
    OptimizationDecision,
    OptimizationStatus,
    Prompt,
    PromptEventType,
    PromptOptimization,
    PromptStatus,
    User,
    utcnow,
)
from . import pricing, providers
from .. import secrets_store
from .meta_prompt import META_PROMPT_VERSION, build_meta_prompt, parse_result
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

    def provider_for(self, uid: int) -> str:
        """Which optimizer this user's work runs through.

        A user who stored their OWN Anthropic key gets the server-side API
        provider — that is the whole point of storing one: their optimizations
        must not be paid for by the owner's Claude subscription. Everyone else
        (in practice the owner) keeps the Claude Code CLI on the runner Mac,
        which is what has been running all along.
        """
        user = self.session.get(User, uid)
        if user is not None and secrets_store.decrypt(user.anthropic_key_enc):
            return providers.ANTHROPIC_API.id
        return self.settings.optimize_provider

    def model_for(self, uid: int, spec: providers.ProviderSpec) -> str:
        """The model to bill.

        ⚠️ The two paths do NOT share a model name. `OPTIMIZE_MODEL` is a CLI
        alias ("opus") that the Messages API rejects, so a server job takes the
        user's chosen model or the priced default — never the CLI setting.
        """
        if spec.executed_by == "server":
            user = self.session.get(User, uid)
            chosen = (user.optimize_model if user else None) or ""
            return chosen if pricing.is_known(chosen) else pricing.DEFAULT_MODEL
        return self.settings.optimize_model or spec.default_model

    def _queue_for(
        self,
        prompt: Prompt,
        uid: int,
        *,
        provider: str | None,
        batch_id: str | None,
    ) -> PromptOptimization:
        # Optimizing is PREPARATION: a prompt that is running or done has
        # already been used, and rewriting its text there costs money for a
        # result nobody will send. The batch below catches this and SKIPS such
        # prompts, which is why the rule lives here rather than in the routers —
        # one place, both entry points.
        if prompt.status is not PromptStatus.queued:
            raise OptimizationError(
                "Nur Prompts in der Queue können optimiert werden", 400
            )
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

        spec = providers.get(provider or self.provider_for(uid))
        previous = self.repo.latest_successful(prompt.id, uid)
        job = PromptOptimization(
            user_id=uid,
            prompt_id=prompt.id,
            batch_id=batch_id,
            version=self.repo.next_version(prompt.id, uid),
            status=OptimizationStatus.queued,
            provider=spec.id,
            model=self.model_for(uid, spec),
            meta_prompt_version=META_PROMPT_VERSION,
            # Bookmarks are the reusable shelf: rewrite them to fit any project
            # instead of only sharpening them for the one they came from.
            universal=bool(prompt.bookmarked),
            original_text=body,
            previous_text=previous.optimized_text if previous else None,
            # Momentaufnahmen wie der Text: die Historie muss auch dann noch
            # lesbar sein, wenn Titel und Schlagworte laengst andere sind.
            original_title=prompt.title or "",
            original_tags=prompt.tags or "",
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
            raise OptimizationError("Keine Prompts in der Queue zum Optimieren", 400)

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
    def claim(self, runner_id: str, provider_ids: list[str] | None = None) -> ClaimedJob | None:
        """Hand the next queued job to an executor (atomic, one at a time).

        The Mac runner asks without an argument and gets only runner-executed
        work; the in-process worker asks for the server-executed providers.
        """
        job = self.repo.claim_next(
            runner_id, provider_ids if provider_ids is not None else providers.runner_ids()
        )
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
                job.original_text,
                job.previous_text,
                universal=job.universal,
                title=job.original_title,
                tags=job.original_tags,
                vocabulary=self._vocabulary(job.user_id),
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
        # Nur der KOERPER landet in `optimized_text` - Diff, Uebernehmen und
        # Historie sehen damit exakt das, was sie vorher gesehen haben; Titel
        # und Schlagworte kommen additiv daneben.
        parsed = parse_result(result.optimized_text or "")
        text = parsed.body
        status = OptimizationStatus(result.status)
        if status == OptimizationStatus.succeeded and not text:
            status = OptimizationStatus.failed
            job.error = "Optimierung lieferte keinen Text zurück"
        else:
            job.error = (result.error or None) if status != OptimizationStatus.succeeded else None

        job.status = status
        job.optimized_text = text or None
        job.optimized_title = parsed.title
        job.optimized_tags = parsed.tags
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

    #: Wie viele der eigenen Schlagworte dem Modell gezeigt werden. Genug,
    #: um das Schema eines Kontos zu erkennen, wenig genug, um nichts zu
    #: kosten - in der Produktion sind es ohnehin nur knapp zwanzig.
    VOCABULARY_LIMIT = 40

    def _vocabulary(self, uid: int | None) -> list[str]:
        """Die Schlagworte dieses Kontos, meistgenutzte zuerst.

        Das ist der Unterschied zwischen einem Vorschlag aus dem Nichts und
        dem Fortschreiben eines vorhandenen Schemas: ohne diese Liste
        erfindet ein Modell `bug-fixing` neben dem `bugfix`, das seit
        Monaten in Gebrauch ist.
        """
        if uid is None:
            return []
        rows, _ = TagService(self.session).list_with_usage(
            uid, sort='usage', limit=self.VOCABULARY_LIMIT
        )
        return [row.tag.name for row in rows]

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
        # Only ONE proposal may be open per prompt. Optimizing twice without
        # deciding used to leave both rows pending: the prompt showed v2 while
        # v1 stayed applicable, so taking the older one over wrote text the user
        # had never seen in the diff.
        for older in self.repo.history(job.prompt_id, job.user_id):
            if older.id != job.id and older.decision is OptimizationDecision.pending:
                older.decision = OptimizationDecision.superseded
                older.decided_at = now
                self.session.add(older)
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
            if job.optimized_title:
                prompt.title = job.optimized_title
            if job.optimized_tags:
                # Der EINE Schreibpfad fuer Schlagworte (`Prompt.tags` ist nur
                # ein Cache darueber). Ein leerer Vorschlag loescht bewusst
                # nichts: "das Modell hat nichts vorgeschlagen" und "alle
                # Schlagworte sollen weg" sehen im Ergebnis gleich aus, und von
                # den beiden Lesarten ist nur eine verlustfrei.
                TagService(self.session).set_for_prompt(prompt, job.optimized_tags, uid=uid)
            prompt.updated_at = now
            # The one place this is written: it is what "dieser Prompt wurde
            # per KI optimiert" means, as opposed to "es lag mal ein Vorschlag
            # vor". Discarding deliberately leaves it untouched.
            prompt.optimization_applied_at = now
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

    def discard_for_prompt(self, prompt_id: int) -> list[int]:
        """Drop a deleted prompt's optimization history; return the lost job ids.

        Called from the prompt-delete path, which has to clear the rows anyway:
        `prompt_optimization.prompt_id` is NOT NULL, so unlike a `RunStep` (which
        keeps a text snapshot and is merely detached) these cannot outlive their
        prompt. What the delete must NOT do is leave the rest of the machinery
        believing they are still coming:

        * A job still queued or running is settled as `canceled` first, so any
          batch it belongs to is re-counted with it out of the picture. Without
          that, deleting the last outstanding prompt of a batch left the batch
          with no job to ever call `_finish_batch_if_done` — `finished_at` stayed
          null and the progress pill polled every two seconds forever.
        * The ids are handed back so the caller can say out loud what was
          thrown away. The executor is still working on a running one, and its
          result will be refused (the row is gone by then) — that refusal is
          expected, and the runner logs it as discarded work rather than as a
          transient poll failure.

        Stopping the CLI mid-run would need a runner-facing liveness channel;
        it finishes and its answer is dropped.
        """
        jobs = list(
            self.session.exec(
                select(PromptOptimization).where(PromptOptimization.prompt_id == prompt_id)
            ).all()
        )
        if not jobs:
            return []

        in_flight = [job for job in jobs if job.status not in OPTIMIZATION_TERMINAL]
        now = utcnow()
        for job in in_flight:
            job.status = OptimizationStatus.canceled
            job.finished_at = now
            self.session.add(job)
        self.session.flush()

        batch_ids = {job.batch_id for job in jobs if job.batch_id}
        for job in jobs:
            self.session.delete(job)
        self.session.flush()

        for batch_id in batch_ids:
            self._settle_batch(batch_id)

        if in_flight:
            log.info(
                "prompt %s deleted with %s optimization(s) in flight: %s",
                prompt_id,
                len(in_flight),
                ", ".join(str(job.id) for job in in_flight),
            )
        return [job.id for job in in_flight if job.id is not None]

    def _finish_batch_if_done(self, job: PromptOptimization) -> None:
        if not job.batch_id:
            return
        self._settle_batch(job.batch_id)

    def _settle_batch(self, batch_id: str) -> None:
        """Close a batch once nothing of it is outstanding any more.

        Split out from `_finish_batch_if_done` because a batch also has to be
        re-checked when a job DISAPPEARS, where there is no job left to pass in.
        """
        batch = self.session.get(OptimizationBatch, batch_id)
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
