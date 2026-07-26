"""Activity log writer — the ONLY place that creates `PromptEvent` rows.

Every prompt mutation funnels through `record()` so the statistics dashboard
has a single, consistent source of truth for "what happened when". Recording is
deliberately fire-and-forget from the caller's perspective: the event is added
to the caller's session and committed with it, so a failed request never leaves
a phantom event behind.

Writing an event also invalidates the cached statistics of that tenant
(`app.stats.invalidate`), which keeps the dashboard live without polling.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .models import Prompt, PromptEvent, PromptEventType, PromptStatus, utcnow

# Events older than this are pruned by `prune()` (called from the daily GC).
RETENTION_DAYS = 730


def record(
    session: Session,
    prompt: Prompt,
    event: PromptEventType,
    *,
    status: PromptStatus | None = None,
    at: datetime | None = None,
) -> PromptEvent:
    """Append one activity event for `prompt` (added to the caller's session).

    `status` defaults to the prompt's current status; pass it explicitly when
    recording a transition whose target is already applied to the row.
    """
    row = PromptEvent(
        user_id=prompt.user_id,
        prompt_id=prompt.id,
        project_id=prompt.project_id,
        event=event,
        status=status if status is not None else prompt.status,
        body_len=len(prompt.body or ""),
        at=at or utcnow(),
    )
    session.add(row)
    invalidate(prompt.user_id)
    return row


def record_many(
    session: Session, prompts: list[Prompt], event: PromptEventType
) -> list[PromptEvent]:
    """Bulk variant for batch operations (import, merge, reorder)."""
    return [record(session, p, event) for p in prompts]


def invalidate(user_id: int | None) -> None:
    """Drop cached statistics for a tenant (imported lazily to avoid a cycle)."""
    from . import stats

    stats.invalidate(user_id)


def prune(session: Session, *, now: datetime | None = None) -> int:
    """Delete events past the retention window. Returns the number removed."""
    cutoff = (now or utcnow()) - timedelta(days=RETENTION_DAYS)
    # Compare naive-UTC: SQLite stores the timestamps without tzinfo.
    cutoff_naive = cutoff.astimezone(timezone.utc).replace(tzinfo=None)
    stale = session.exec(select(PromptEvent).where(PromptEvent.at < cutoff_naive)).all()
    for row in stale:
        session.delete(row)
    if stale:
        session.commit()
        invalidate(None)
    return len(stale)
