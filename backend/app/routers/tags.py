"""Tag endpoints — HTTP shell around `app.tags`.

Everything is scoped to the calling tenant; the vocabulary is per user, so two
accounts can use the same word without ever seeing each other's tags.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Tag
from ..schemas import (
    PromptRef,
    TagCreate,
    TagDeleteResult,
    TagListResponse,
    TagRead,
    TagRenameResult,
    TagUpdate,
    TagUsageRead,
)
from ..tags import TagError, TagService, TagWithUsage

router = APIRouter(prefix="/tags", tags=["tags"])


def _read(tag: Tag, usage: int) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        source=tag.source,
        usage_count=usage,
        created_at=tag.created_at,
        last_used_at=tag.last_used_at,
    )


def _read_row(row: TagWithUsage) -> TagRead:
    return _read(row.tag, row.usage_count)


def _fail(exc: TagError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("", response_model=TagListResponse)
def list_tags(
    q: str | None = Query(default=None, description="Substring filter (case-insensitive)"),
    sort: str = Query(default="usage", pattern="^(usage|name|created|recent)$"),
    # ge=1: the repository pages with rows[offset:offset+limit], where a
    # negative limit would slice from the end and return an arbitrary subset.
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> TagListResponse:
    """The vocabulary with usage counts — feeds both the manager and the autocomplete."""
    rows, total = TagService(session).list_with_usage(
        uid, query=q, sort=sort, limit=limit, offset=offset
    )
    return TagListResponse(items=[_read_row(r) for r in rows], total=total)


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> TagRead:
    """Add a tag to the vocabulary without attaching it to anything yet."""
    service = TagService(session)
    try:
        tag = service.create(uid, payload.name, source=payload.source)
    except TagError as exc:
        raise _fail(exc) from exc
    return _read(tag, 0)


@router.get("/{tag_id}/usage", response_model=TagUsageRead)
def tag_usage(
    tag_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> TagUsageRead:
    """Which prompts carry this tag — the impact preview before deleting."""
    service = TagService(session)
    try:
        tag, prompts = service.usage(uid, tag_id)
    except TagError as exc:
        raise _fail(exc) from exc
    return TagUsageRead(
        tag=_read(tag, len(prompts)),
        prompts=[
            PromptRef(id=p.id, title=p.title, status=p.status, project_id=p.project_id)
            for p in prompts
        ],
    )


@router.patch("/{tag_id}", response_model=TagRenameResult)
def rename_tag(
    tag_id: int,
    payload: TagUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> TagRenameResult:
    """Rename globally. Renaming onto an existing tag merges the two."""
    service = TagService(session)
    try:
        tag, merged = service.rename(uid, tag_id, payload.name)
    except TagError as exc:
        raise _fail(exc) from exc
    counts = service.repo.usage_counts(uid)
    return TagRenameResult(tag=_read(tag, counts.get(tag.id, 0)), merged=merged)


@router.delete("/{tag_id}", response_model=TagDeleteResult)
def delete_tag(
    tag_id: int,
    replace_with: int | None = Query(default=None, description="Re-point assignments here"),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> TagDeleteResult:
    """Remove a tag, optionally replacing it on every prompt that used it."""
    service = TagService(session)
    try:
        touched = service.delete(uid, tag_id, replace_with=replace_with)
    except TagError as exc:
        raise _fail(exc) from exc
    return TagDeleteResult(deleted=1, prompts_updated=touched, replaced_with=replace_with)
