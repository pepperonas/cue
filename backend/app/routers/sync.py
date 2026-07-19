"""Snippet sync with Inspector Rust (IR).

IR is the polling client (cue cannot reach the desktop): every cycle it PULLs
`GET /sync/snippets` (scope + snippets + tombstones), applies them locally,
then PUSHes its own scope snippets + tombstones to `POST /sync/snippets`.

Both endpoints are guarded by the per-user `snippet_sync_token` (Bearer).
The sync scope is managed in cue only: groups with `synced=True` plus the
per-user `sync_ungrouped` flag; everything else is ignored on both directions.

Merge rule (identical on both sides, deterministic):
- incoming.version > local.version  -> take incoming content
- equal versions, identical content -> no-op
- equal versions, different content -> cue wins (server keeps its own; IR
  adopts cue's copy on pull)
- incoming.version < local.version  -> keep local

Group membership is NOT version-gated — cue is the organizational master
(the workbench + scope config live here): IR adopts cue's grouping on pull,
cue ignores incoming categories for existing snippets.

Tombstones propagate deletions: a tombstone deletes the peer's copy only if
that copy isn't newer (peer.version <= tombstone.version); recreations start
at tombstone.version + 1 (see `snippets.resurrect_floor`). Received tombstones
are stored locally too, so the version floor survives even after the deleting
side prunes (90 days).
"""
from __future__ import annotations

import secrets
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Snippet, SnippetGroup, SnippetTombstone, User, utcnow
from ..schemas import (
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResult,
    SyncSettingsRead,
    SyncSettingsUpdate,
    SyncSnippetItem,
    SyncTombstoneItem,
)
from .snippets import (
    _get_or_create_group,
    _next_snippet_order,
    record_tombstone,
    tombstone_for,
)

router = APIRouter(prefix="/sync", tags=["sync"])

TOMBSTONE_TTL_DAYS = 90


def _resolve_sync_user(session: Session, authorization: str | None) -> User:
    """Map the sync Bearer token to its user (per-user token, like capture)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing sync token")
    token = authorization[len("Bearer ") :]
    if token:
        user = session.exec(select(User).where(User.snippet_sync_token == token)).first()
        if user:
            return user
    raise HTTPException(status_code=401, detail="Invalid sync token")


def _scope(session: Session, user: User) -> tuple[set[str], bool]:
    groups = {
        g.name
        for g in session.exec(
            select(SnippetGroup).where(
                SnippetGroup.user_id == user.id, SnippetGroup.synced == True  # noqa: E712
            )
        ).all()
    }
    return groups, user.sync_ungrouped


def _in_scope(category: str | None, groups: set[str], ungrouped: bool) -> bool:
    return (category in groups) if category else ungrouped


def _prune_tombstones(session: Session, uid: int) -> None:
    cutoff = utcnow() - timedelta(days=TOMBSTONE_TTL_DAYS)
    for ts in session.exec(
        select(SnippetTombstone).where(
            SnippetTombstone.user_id == uid, SnippetTombstone.deleted_at < cutoff
        )
    ).all():
        session.delete(ts)


def _to_ms(dt) -> int:  # noqa: ANN001
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


# ---- IR-facing (Bearer snippet_sync_token) ----
@router.get("/snippets", response_model=SyncPullResponse)
def pull(
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> SyncPullResponse:
    user = _resolve_sync_user(session, authorization)
    _prune_tombstones(session, user.id)
    groups, ungrouped = _scope(session, user)

    snippets = [
        SyncSnippetItem(
            abbreviation=s.abbreviation,
            title=s.title,
            body=s.body,
            category=s.group_name or "",
            version=s.version,
        )
        for s in session.exec(
            select(Snippet)
            .where(Snippet.user_id == user.id)
            .order_by(Snippet.group_name, Snippet.sort_order, Snippet.id)
        ).all()
        if _in_scope(s.group_name, groups, ungrouped)
    ]
    tombstones = [
        SyncTombstoneItem(
            abbreviation=ts.abbreviation,
            version=ts.version,
            deleted_at_ms=_to_ms(ts.deleted_at),
        )
        for ts in session.exec(
            select(SnippetTombstone).where(SnippetTombstone.user_id == user.id)
        ).all()
        if _in_scope(ts.group_name, groups, ungrouped)
    ]
    user.snippet_sync_last = utcnow()
    session.add(user)
    session.commit()
    return SyncPullResponse(
        groups=sorted(groups),
        sync_ungrouped=ungrouped,
        snippets=snippets,
        tombstones=tombstones,
    )


@router.post("/snippets", response_model=SyncPushResult)
def push(
    payload: SyncPushRequest,
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> SyncPushResult:
    user = _resolve_sync_user(session, authorization)
    uid = user.id
    groups, ungrouped = _scope(session, user)
    created = updated = unchanged = kept_local = deleted = ignored = 0

    # Tombstones first: a snippet deleted on the IR side must not survive the
    # same cycle. Stored locally either way (version floor for recreations).
    for ts in payload.tombstones:
        abbreviation = ts.abbreviation.strip()
        if not abbreviation:
            ignored += 1
            continue
        local = session.exec(
            select(Snippet).where(
                Snippet.user_id == uid, Snippet.abbreviation == abbreviation
            )
        ).first()
        if local is not None:
            if not _in_scope(local.group_name, groups, ungrouped):
                ignored += 1
                continue
            if local.version <= ts.version:
                record_tombstone(session, uid, abbreviation, local.group_name, ts.version)
                session.delete(local)
                deleted += 1
            else:
                kept_local += 1  # edited here after the peer deleted — edit wins
        else:
            record_tombstone(session, uid, abbreviation, None, ts.version)

    for item in payload.snippets:
        abbreviation = item.abbreviation.strip()
        if not abbreviation or not _in_scope(item.category or None, groups, ungrouped):
            ignored += 1
            continue
        ts = tombstone_for(session, uid, abbreviation)
        if ts is not None:
            if item.version <= ts.version:
                ignored += 1  # deleted here; IR drops its copy via the pull
                continue
            session.delete(ts)  # recreated above the tombstone — resurrect
        local = session.exec(
            select(Snippet).where(
                Snippet.user_id == uid, Snippet.abbreviation == abbreviation
            )
        ).first()
        if local is None:
            group_name = None
            if item.category:
                group, _ = _get_or_create_group(session, uid, item.category)
                group_name = group.name
            session.add(
                Snippet(
                    user_id=uid,
                    abbreviation=abbreviation,
                    title=item.title,
                    body=item.body,
                    group_name=group_name,
                    sort_order=_next_snippet_order(session, uid, group_name),
                    version=max(item.version, 1),
                )
            )
            session.flush()
            created += 1
        elif item.version > local.version:
            # Content follows the higher version; grouping stays cue's (master).
            local.title = item.title
            local.body = item.body
            local.version = item.version
            local.updated_at = utcnow()
            session.add(local)
            updated += 1
        elif item.version == local.version and (
            item.title == local.title and item.body == local.body
        ):
            unchanged += 1
        else:
            kept_local += 1  # equal-version conflict (cue wins) or local newer

    user.snippet_sync_last = utcnow()
    session.add(user)
    session.commit()
    return SyncPushResult(
        created=created,
        updated=updated,
        unchanged=unchanged,
        kept_local=kept_local,
        deleted=deleted,
        ignored=ignored,
    )


# ---- Owner-facing settings (cookie auth) ----
@router.get("/settings", response_model=SyncSettingsRead)
def get_sync_settings(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> SyncSettingsRead:
    user = session.get(User, uid)
    return SyncSettingsRead(
        has_token=bool(user and user.snippet_sync_token),
        sync_ungrouped=bool(user and user.sync_ungrouped),
        last_sync=user.snippet_sync_last if user else None,
    )


@router.post("/settings", response_model=SyncSettingsRead)
def update_sync_settings(
    payload: SyncSettingsUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> SyncSettingsRead:
    user = session.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.sync_ungrouped is not None:
        user.sync_ungrouped = payload.sync_ungrouped
    token_once: str | None = None
    if payload.regenerate:
        token_once = secrets.token_hex(32)
        user.snippet_sync_token = token_once
    session.add(user)
    session.commit()
    return SyncSettingsRead(
        has_token=bool(user.snippet_sync_token),
        sync_ungrouped=user.sync_ungrouped,
        last_sync=user.snippet_sync_last,
        token=token_once,
    )
