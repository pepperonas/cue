"""Persistence for optimizations — the only place that talks SQL for them.

No business rules here (that is `service.py`), no subprocesses, no HTTP: the
repository just reads and writes rows for one tenant.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session, select

from ..models import (
    OPTIMIZATION_TERMINAL,
    OptimizationBatch,
    OptimizationStatus,
    Prompt,
    PromptOptimization,
    utcnow,
)


class OptimizationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ---- prompts -----------------------------------------------------------
    def owned_prompt(self, prompt_id: int, uid: int) -> Prompt | None:
        prompt = self.session.get(Prompt, prompt_id)
        return prompt if prompt and prompt.user_id == uid else None

    def prompts_for_batch(self, uid: int, *, project_id: int | None, only_pending: bool) -> list[Prompt]:
        """Candidates for "optimize everything", in board order."""
        stmt = select(Prompt).where(Prompt.user_id == uid)
        if project_id is not None:
            stmt = stmt.where(Prompt.project_id == project_id)
        if only_pending:
            stmt = stmt.where(Prompt.optimized == False)  # noqa: E712
        return list(self.session.exec(stmt.order_by(Prompt.status, Prompt.sort_order, Prompt.id)).all())

    # ---- optimizations -----------------------------------------------------
    def get(self, optimization_id: int, uid: int) -> PromptOptimization | None:
        row = self.session.get(PromptOptimization, optimization_id)
        return row if row and row.user_id == uid else None

    def history(self, prompt_id: int, uid: int) -> list[PromptOptimization]:
        stmt = (
            select(PromptOptimization)
            .where(PromptOptimization.prompt_id == prompt_id, PromptOptimization.user_id == uid)
            .order_by(PromptOptimization.version.desc(), PromptOptimization.id.desc())
        )
        return list(self.session.exec(stmt).all())

    def latest_successful(self, prompt_id: int, uid: int) -> PromptOptimization | None:
        stmt = (
            select(PromptOptimization)
            .where(
                PromptOptimization.prompt_id == prompt_id,
                PromptOptimization.user_id == uid,
                PromptOptimization.status == OptimizationStatus.succeeded,
            )
            .order_by(PromptOptimization.version.desc())
            .limit(1)
        )
        return self.session.exec(stmt).first()

    def active_for_prompt(self, prompt_id: int, uid: int) -> PromptOptimization | None:
        stmt = select(PromptOptimization).where(
            PromptOptimization.prompt_id == prompt_id,
            PromptOptimization.user_id == uid,
            PromptOptimization.status.in_(
                [OptimizationStatus.queued, OptimizationStatus.running]
            ),
        )
        return self.session.exec(stmt).first()

    def next_version(self, prompt_id: int, uid: int) -> int:
        stmt = select(PromptOptimization.version).where(
            PromptOptimization.prompt_id == prompt_id, PromptOptimization.user_id == uid
        )
        versions = list(self.session.exec(stmt).all())
        return (max(versions) + 1) if versions else 1

    def add(self, row: PromptOptimization) -> PromptOptimization:
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)
        return row

    def list_active(self, uid: int) -> list[PromptOptimization]:
        stmt = (
            select(PromptOptimization)
            .where(
                PromptOptimization.user_id == uid,
                PromptOptimization.status.in_(
                    [OptimizationStatus.queued, OptimizationStatus.running]
                ),
            )
            .order_by(PromptOptimization.created_at)
        )
        return list(self.session.exec(stmt).all())

    def claim_next(self, runner_id: str) -> PromptOptimization | None:
        """Atomically hand the oldest queued job to one runner.

        Single UPDATE ... RETURNING, exactly like the run engine's claim: two
        runners polling concurrently can never take the same job. Jobs of a
        canceled batch are skipped.
        """
        now = utcnow()
        row = self.session.exec(
            text(
                """
                UPDATE prompt_optimization
                   SET status = 'running', runner_id = :runner, started_at = :now
                 WHERE id = (
                       SELECT o.id FROM prompt_optimization o
                       LEFT JOIN optimization_batch b ON b.id = o.batch_id
                        WHERE o.status = 'queued'
                          AND COALESCE(b.canceled, 0) = 0
                        ORDER BY o.created_at, o.id
                        LIMIT 1)
             RETURNING id
                """
            ).bindparams(runner=runner_id, now=now)
        ).first()
        self.session.commit()
        if not row:
            return None
        return self.session.get(PromptOptimization, row[0])

    def stale_running(self, cutoff) -> list[PromptOptimization]:  # noqa: ANN001
        stmt = select(PromptOptimization).where(
            PromptOptimization.status == OptimizationStatus.running,
            PromptOptimization.started_at < cutoff,
        )
        return list(self.session.exec(stmt).all())

    # ---- batches -----------------------------------------------------------
    def add_batch(self, batch: OptimizationBatch) -> OptimizationBatch:
        self.session.add(batch)
        self.session.commit()
        self.session.refresh(batch)
        return batch

    def get_batch(self, batch_id: str, uid: int) -> OptimizationBatch | None:
        row = self.session.get(OptimizationBatch, batch_id)
        return row if row and row.user_id == uid else None

    def active_batch(self, uid: int) -> OptimizationBatch | None:
        stmt = (
            select(OptimizationBatch)
            .where(OptimizationBatch.user_id == uid, OptimizationBatch.finished_at == None)  # noqa: E711
            .order_by(OptimizationBatch.created_at.desc())
            .limit(1)
        )
        return self.session.exec(stmt).first()

    def batch_jobs(self, batch_id: str) -> list[PromptOptimization]:
        stmt = (
            select(PromptOptimization)
            .where(PromptOptimization.batch_id == batch_id)
            .order_by(PromptOptimization.id)
        )
        return list(self.session.exec(stmt).all())

    def batch_counts(self, batch_id: str) -> dict[str, int]:
        counts = {"total": 0, "done": 0, "failed": 0, "pending": 0}
        for job in self.batch_jobs(batch_id):
            counts["total"] += 1
            if job.status == OptimizationStatus.succeeded:
                counts["done"] += 1
            elif job.status in OPTIMIZATION_TERMINAL:
                counts["failed"] += 1
            else:
                counts["pending"] += 1
        return counts
