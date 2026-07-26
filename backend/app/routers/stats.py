"""Statistics endpoint — thin HTTP shell around `app.stats`.

The aggregation itself lives in the service module; this router only resolves
query parameters into a `TimeRange` and hands back the payload for the calling
tenant. Everything is scoped by `current_user_id`, so the dashboard can never
show another user's numbers.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from .. import stats
from ..db import get_session
from ..deps import current_user_id

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("")
def get_stats(
    range_key: str = Query(default="30d", alias="range"),
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
    tz: str | None = Query(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> dict[str, Any]:
    """Full dashboard payload for one range.

    `range` is one of `stats.PRESETS`; `from`/`to` are only read for
    `range=custom` and are interpreted as calendar days in `tz` (the client's
    IANA timezone, e.g. `Europe/Berlin`), so buckets line up with the user's
    day boundaries rather than UTC's.
    """
    zone = stats.resolve_tz(tz)
    rng = stats.resolve_range(
        range_key if range_key in stats.PRESETS else "30d",
        zone,
        start=start,
        end=end,
        first_activity=stats.first_activity(session, uid) if range_key == "all" else None,
    )
    return stats.build(session, uid, rng)
