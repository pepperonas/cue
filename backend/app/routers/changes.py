"""Live-update feed: one long-polled endpoint the browsers hang off.

`GET /api/changes?since=<cursor>&wait=25` answers as soon as anything in the
caller's own data differs from `since`, or after the budget with the unchanged
cursor. That is what makes two devices agree without either of them polling:
the request costs nothing while nothing happens, and lands within a second when
it does.

**No `Depends(get_session)` here.** The request is parked for up to 25 s, and
the pool holds five connections — see the note in `app.longpoll`. Authentication
therefore reads the signed cookie only (no database), and the approval check
runs inside each attempt on that attempt's own session. That is not a
concession: it means revoking approval ends a parked poll on the next tick
instead of whenever it happens to return.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session

from .. import changes as changes_mod
from .. import db
from ..deps import current_session
from ..longpoll import claim_with_wait
from ..models import User

router = APIRouter(tags=["changes"])


class ChangeFeed(BaseModel):
    cursor: str
    # Entity keys whose data moved since `since`; empty when the budget ran out
    # with nothing to report.
    changed: list[str] = []


def _uid(session: dict) -> int:
    uid = session.get("uid")
    if not isinstance(uid, int):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return uid


def _look(uid: int, before: dict[str, str]):
    """One attempt: read the tenant's fingerprint, report only real movement."""

    def attempt(session: Session) -> ChangeFeed | None:
        user = session.get(User, uid)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
            )
        if not user.approved:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Konto wartet auf Freischaltung"
            )
        now = changes_mod.fingerprint(session, uid)
        moved = changes_mod.changed(before, now)
        if not moved:
            return None
        return ChangeFeed(cursor=changes_mod.encode(now), changed=moved)

    return attempt


@router.get("/changes", response_model=ChangeFeed)
async def poll_changes(
    since: str | None = Query(None, description="Cursor from the previous answer."),
    wait: float = Query(
        0, ge=0, description="Seconds to hold the request open while nothing changes."
    ),
    session: dict = Depends(current_session),
):
    """Wait for this tenant's data to change; answer with the new cursor.

    Without `since` this returns the current cursor immediately and reports
    nothing as changed — that is how a client picks up its starting point
    without pulling every list a second time right after it loaded them.
    """
    uid = _uid(session)
    before = changes_mod.decode(since)
    if not before:
        with Session(db.engine) as s:  # `db.engine` late — see app/longpoll.py
            return ChangeFeed(cursor=changes_mod.encode(changes_mod.fingerprint(s, uid)))

    feed = await claim_with_wait(_look(uid, before), wait=wait)
    if feed is not None:
        return feed
    # Budget spent with nothing new: hand the cursor back unchanged so the
    # client can go straight back into the next wait.
    return ChangeFeed(cursor=changes_mod.encode(before))
