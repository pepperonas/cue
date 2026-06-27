"""Prompt CRUD, filtering, and reorder endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_session, require_csrf
from ..models import Project, Prompt, PromptStatus, utcnow
from ..schemas import (
    BookmarkReorderRequest,
    PromptCreate,
    PromptRead,
    PromptUpdate,
    ReorderRequest,
)

router = APIRouter(prefix="/prompts", tags=["prompts"])

# Statuses that imply the prompt has been acted on -> stamp ran_at once.
_RAN_STATUSES = {PromptStatus.running, PromptStatus.done}


def _derive_title(title: str, body: str) -> str:
    if title.strip():
        return title.strip()
    first_line = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
    # Strip a leading markdown heading marker for a cleaner title.
    cleaned = first_line.lstrip("#").strip()
    return cleaned[:120] if cleaned else "Untitled prompt"


def _next_sort_order(session: Session, status_value: PromptStatus) -> int:
    current_max = session.exec(
        select(func.max(Prompt.sort_order)).where(Prompt.status == status_value)
    ).one()
    return (current_max or 0) + 1


def _next_bookmark_order(session: Session) -> int:
    current_max = session.exec(
        select(func.max(Prompt.bookmark_order)).where(Prompt.bookmarked == True)  # noqa: E712
    ).one()
    return (current_max or 0) + 1


@router.get("", response_model=list[PromptRead])
def list_prompts(
    project_id: int | None = Query(default=None),
    status_filter: PromptStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
) -> list[Prompt]:
    statement = select(Prompt)
    if project_id is not None:
        statement = statement.where(Prompt.project_id == project_id)
    if status_filter is not None:
        statement = statement.where(Prompt.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        statement = statement.where(or_(Prompt.title.ilike(like), Prompt.body.ilike(like)))
    statement = statement.order_by(Prompt.status, Prompt.sort_order, Prompt.id)
    return session.exec(statement).all()


@router.post("", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def create_prompt(
    payload: PromptCreate,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Body required")
    if payload.project_id is not None and not session.get(Project, payload.project_id):
        raise HTTPException(status_code=400, detail="Unknown project")

    prompt = Prompt(
        title=_derive_title(payload.title, payload.body),
        body=payload.body,
        project_id=payload.project_id,
        status=payload.status,
        tags=payload.tags.strip(),
        sort_order=_next_sort_order(session, payload.status),
    )
    if payload.status in _RAN_STATUSES:
        prompt.ran_at = utcnow()
    session.add(prompt)
    session.commit()
    session.refresh(prompt)
    return prompt


@router.get("/{prompt_id}", response_model=PromptRead)
def get_prompt(
    prompt_id: int,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
) -> Prompt:
    prompt = session.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.patch("/{prompt_id}", response_model=PromptRead)
def update_prompt(
    prompt_id: int,
    payload: PromptUpdate,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    prompt = session.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if payload.body is not None:
        prompt.body = payload.body
    if payload.title is not None:
        prompt.title = payload.title.strip()
    # Re-derive title if it ended up empty after edits.
    if not prompt.title.strip():
        prompt.title = _derive_title("", prompt.body)

    if payload.unassign_project:
        prompt.project_id = None
    elif payload.project_id is not None:
        if not session.get(Project, payload.project_id):
            raise HTTPException(status_code=400, detail="Unknown project")
        prompt.project_id = payload.project_id

    if payload.tags is not None:
        prompt.tags = payload.tags.strip()

    if payload.bookmarked is not None and payload.bookmarked != prompt.bookmarked:
        prompt.bookmarked = payload.bookmarked
        # Newly bookmarked prompts append to the end of the bookmarks section.
        if payload.bookmarked:
            prompt.bookmark_order = _next_bookmark_order(session)

    if payload.status is not None and payload.status != prompt.status:
        prompt.status = payload.status
        prompt.sort_order = _next_sort_order(session, payload.status)
        if payload.status in _RAN_STATUSES and prompt.ran_at is None:
            prompt.ran_at = utcnow()

    prompt.updated_at = utcnow()
    session.add(prompt)
    session.commit()
    session.refresh(prompt)
    return prompt


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(
    prompt_id: int,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> None:
    prompt = session.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    session.delete(prompt)
    session.commit()


@router.post("/reorder", response_model=list[PromptRead])
def reorder_prompts(
    payload: ReorderRequest,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> list[Prompt]:
    """Apply drag results in a single transaction.

    Each item carries its (possibly new) status and sort_order. A status change
    here also stamps ran_at the first time the prompt enters running/done.
    """
    touched: list[Prompt] = []
    for item in payload.items:
        prompt = session.get(Prompt, item.id)
        if not prompt:
            continue
        if prompt.status != item.status:
            prompt.status = item.status
            if item.status in _RAN_STATUSES and prompt.ran_at is None:
                prompt.ran_at = utcnow()
        prompt.sort_order = item.sort_order
        prompt.updated_at = utcnow()
        session.add(prompt)
        touched.append(prompt)
    session.commit()
    for prompt in touched:
        session.refresh(prompt)
    return touched


@router.post("/bookmarks/reorder", response_model=list[PromptRead])
def reorder_bookmarks(
    payload: BookmarkReorderRequest,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> list[Prompt]:
    """Apply a drag-sort of the bookmarks section in one transaction."""
    touched: list[Prompt] = []
    for item in payload.items:
        prompt = session.get(Prompt, item.id)
        if not prompt:
            continue
        prompt.bookmark_order = item.bookmark_order
        session.add(prompt)
        touched.append(prompt)
    session.commit()
    for prompt in touched:
        session.refresh(prompt)
    return touched
