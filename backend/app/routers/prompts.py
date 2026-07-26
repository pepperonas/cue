"""Prompt CRUD, filtering, and reorder endpoints (scoped to the authenticated user)."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, update
from sqlmodel import Session, select

from .. import events
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import (
    Attachment,
    Project,
    Prompt,
    PromptEventType,
    PromptOptimization,
    PromptStatus,
    RunStep,
    utcnow,
)
from ..tags import TagService
from ..schemas import (
    BookmarkReorderRequest,
    DuplicateRequest,
    MergeRequest,
    PromptCreate,
    PromptRead,
    PromptUpdate,
    ReorderRequest,
)
from .attachments import attachment_read, clone_attachment_file, delete_attachment_file

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _reads(session: Session, prompts: list[Prompt]) -> list[PromptRead]:
    """Serialize prompts into PromptRead, batch-loading their attachments."""
    ids = [p.id for p in prompts if p.id is not None]
    by_prompt: dict[int, list] = {}
    if ids:
        for a in session.exec(select(Attachment).where(Attachment.prompt_id.in_(ids))).all():
            by_prompt.setdefault(a.prompt_id, []).append(attachment_read(a))
    return [PromptRead(**p.model_dump(), attachments=by_prompt.get(p.id, [])) for p in prompts]


def _read(session: Session, prompt: Prompt) -> PromptRead:
    return _reads(session, [prompt])[0]


def _attach(session: Session, attachment_ids: list[int] | None, prompt_id: int, uid: int) -> None:
    """Associate the caller's pending/own attachments with a prompt."""
    for aid in attachment_ids or []:
        att = session.get(Attachment, aid)
        if att and att.user_id == uid and att.prompt_id in (None, prompt_id):
            att.prompt_id = prompt_id
            session.add(att)


def _detach_references(session: Session, prompt_id: int) -> None:
    """Clear everything that points at a prompt before it is deleted.

    `foreign_keys=ON` means a dangling reference raises instead of silently
    orphaning: RunStep keeps a text snapshot so it is only detached, while tag
    links and the optimization history belong to the prompt and die with it.
    """
    session.exec(update(RunStep).where(RunStep.prompt_id == prompt_id).values(prompt_id=None))
    TagService(session).clear_for_prompt(prompt_id)
    for row in session.exec(
        select(PromptOptimization).where(PromptOptimization.prompt_id == prompt_id)
    ).all():
        session.delete(row)
    # Flush the child deletes first: without an ORM relationship SQLAlchemy has
    # no dependency to order them by, and SQLite would reject the parent DELETE.
    session.flush()


def _purge_attachments(session: Session, prompt_id: int) -> None:
    for att in session.exec(select(Attachment).where(Attachment.prompt_id == prompt_id)).all():
        delete_attachment_file(att)
        session.delete(att)

# Statuses that imply the prompt has been acted on -> stamp ran_at once.
_RAN_STATUSES = {PromptStatus.running, PromptStatus.done}


def _derive_title(title: str, body: str) -> str:
    if title.strip():
        return title.strip()
    first_line = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
    # Strip a leading markdown heading marker for a cleaner title.
    cleaned = first_line.lstrip("#").strip()
    return cleaned[:120] if cleaned else "Untitled prompt"


# Trailing "(n)" counter on duplicated titles, e.g. "Fix login (2)".
_DUP_SUFFIX = re.compile(r"^(?P<base>.*\S)\s*\((?P<n>\d+)\)$")


def _dup_title(title: str) -> str:
    """Title for an in-place duplicate: append "(2)", or bump an existing "(n)"."""
    m = _DUP_SUFFIX.match(title)
    if m:
        return f"{m.group('base')} ({int(m.group('n')) + 1})"
    return f"{title} (2)" if title else "Untitled prompt (2)"


def _next_sort_order(session: Session, status_value: PromptStatus, uid: int) -> int:
    current_max = session.exec(
        select(func.max(Prompt.sort_order)).where(
            Prompt.status == status_value, Prompt.user_id == uid
        )
    ).one()
    return (current_max or 0) + 1


def _top_sort_order(session: Session, status_value: PromptStatus, uid: int | None) -> int:
    """Sort order placing a prompt at the TOP of its status column."""
    current_min = session.exec(
        select(func.min(Prompt.sort_order)).where(
            Prompt.status == status_value, Prompt.user_id == uid
        )
    ).one()
    return (current_min if current_min is not None else 1) - 1


def _next_bookmark_order(session: Session, uid: int) -> int:
    current_max = session.exec(
        select(func.max(Prompt.bookmark_order)).where(
            Prompt.bookmarked == True, Prompt.user_id == uid  # noqa: E712
        )
    ).one()
    return (current_max or 0) + 1


def _owned(session: Session, prompt_id: int, uid: int) -> Prompt:
    prompt = session.get(Prompt, prompt_id)
    if not prompt or prompt.user_id != uid:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


def _check_project(session: Session, project_id: int | None, uid: int) -> None:
    if project_id is not None:
        project = session.get(Project, project_id)
        if not project or project.user_id != uid:
            raise HTTPException(status_code=400, detail="Unknown project")


@router.get("", response_model=list[PromptRead])
def list_prompts(
    project_id: int | None = Query(default=None),
    status_filter: PromptStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[Prompt]:
    statement = select(Prompt).where(Prompt.user_id == uid)
    if project_id is not None:
        statement = statement.where(Prompt.project_id == project_id)
    if status_filter is not None:
        statement = statement.where(Prompt.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        statement = statement.where(or_(Prompt.title.ilike(like), Prompt.body.ilike(like)))
    statement = statement.order_by(Prompt.status, Prompt.sort_order, Prompt.id)
    return _reads(session, session.exec(statement).all())


@router.post("", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def create_prompt(
    payload: PromptCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Body required")
    _check_project(session, payload.project_id, uid)

    prompt = Prompt(
        user_id=uid,
        title=_derive_title(payload.title, payload.body),
        body=payload.body,
        project_id=payload.project_id,
        status=payload.status,
        sort_order=_next_sort_order(session, payload.status, uid),
    )
    if payload.status in _RAN_STATUSES:
        prompt.ran_at = utcnow()
    session.add(prompt)
    session.commit()
    session.refresh(prompt)
    # Tags always go through the service: it resolves/creates the vocabulary
    # entries, writes the links and refreshes the denormalized cache string.
    TagService(session).set_for_prompt(prompt, payload.tags, uid=uid)
    session.add(prompt)
    _attach(session, payload.attachment_ids, prompt.id, uid)
    events.record(session, prompt, PromptEventType.created)
    session.commit()
    session.refresh(prompt)
    return _read(session, prompt)


@router.get("/{prompt_id}", response_model=PromptRead)
def get_prompt(
    prompt_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> PromptRead:
    return _read(session, _owned(session, prompt_id, uid))


@router.patch("/{prompt_id}", response_model=PromptRead)
def update_prompt(
    prompt_id: int,
    payload: PromptUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    prompt = _owned(session, prompt_id, uid)
    # Snapshot for the activity log: only real content edits count as "updated"
    # (a bookmark/tested toggle or a pure status move is not an edit).
    before = (prompt.title, prompt.body, prompt.tags, prompt.project_id)

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
        _check_project(session, payload.project_id, uid)
        prompt.project_id = payload.project_id

    if payload.tags is not None:
        TagService(session).set_for_prompt(prompt, payload.tags, uid=uid)

    if payload.bookmarked is not None and payload.bookmarked != prompt.bookmarked:
        prompt.bookmarked = payload.bookmarked
        # Newly bookmarked prompts append to the end of the bookmarks section.
        if payload.bookmarked:
            prompt.bookmark_order = _next_bookmark_order(session, uid)

    # Tested only exists on done prompts: marking anything else is rejected,
    # and leaving done clears the flag (see the status block below).
    if payload.tested is not None:
        target = payload.status if payload.status is not None else prompt.status
        if payload.tested and target != PromptStatus.done:
            raise HTTPException(status_code=400, detail="Only done prompts can be marked tested")
        prompt.tested = payload.tested

    # Apply blocked BEFORE the status guard so unblock+move works in one PATCH.
    # Blocked only exists on queued prompts: blocking anything else is rejected,
    # and leaving queued clears the flag.
    if payload.blocked is not None:
        target = payload.status if payload.status is not None else prompt.status
        if payload.blocked and target != PromptStatus.queued:
            raise HTTPException(status_code=400, detail="Only queued prompts can be blocked")
        prompt.blocked = payload.blocked

    status_changed = payload.status is not None and payload.status != prompt.status
    if status_changed:
        if prompt.blocked and payload.status in _RAN_STATUSES:
            raise HTTPException(status_code=400, detail="Prompt is blocked")
        if payload.status != PromptStatus.queued:
            prompt.blocked = False
        # Leaving done invalidates the test result (back to queued/running the
        # feature is being worked on again).
        if payload.status != PromptStatus.done:
            prompt.tested = False
        prompt.status = payload.status
        # Freshly-done prompts always surface at the TOP of the done column;
        # every other status change appends at the bottom as before.
        if payload.status == PromptStatus.done:
            prompt.sort_order = _top_sort_order(session, PromptStatus.done, uid)
        else:
            prompt.sort_order = _next_sort_order(session, payload.status, uid)
        if payload.status in _RAN_STATUSES and prompt.ran_at is None:
            prompt.ran_at = utcnow()

    prompt.updated_at = utcnow()
    session.add(prompt)
    _attach(session, payload.attachment_ids, prompt.id, uid)
    if (prompt.title, prompt.body, prompt.tags, prompt.project_id) != before:
        events.record(session, prompt, PromptEventType.updated)
    if status_changed:
        events.record(session, prompt, PromptEventType.status_changed)
    session.commit()
    session.refresh(prompt)
    return _read(session, prompt)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(
    prompt_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    prompt = _owned(session, prompt_id, uid)
    _purge_attachments(session, prompt_id)
    _detach_references(session, prompt_id)
    # Record BEFORE the delete — the event snapshots the row it outlives.
    events.record(session, prompt, PromptEventType.deleted)
    session.delete(prompt)
    session.commit()


@router.post(
    "/{prompt_id}/duplicate", response_model=PromptRead, status_code=status.HTTP_201_CREATED
)
def duplicate_prompt(
    prompt_id: int,
    payload: DuplicateRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    """Copy a prompt (title/body/tags + screenshots).

    Default mode copies into another project: the copy always starts as
    `queued` in the target project with the title verbatim. `in_place=true`
    instead duplicates everything where it is: same project AND status, title
    suffixed "(n+1)", same sort_order as the source (the higher id tie-breaks
    it directly below the original). Attachment files are duplicated on disk
    either way so the copy owns its screenshots independently."""
    src = _owned(session, prompt_id, uid)

    if payload.in_place:
        copy = Prompt(
            user_id=uid,
            title=_dup_title(src.title),
            body=src.body,
            project_id=src.project_id,
            status=src.status,
            sort_order=src.sort_order,
            blocked=src.blocked,
        )
        if src.bookmarked:
            copy.bookmarked = True
            copy.bookmark_order = _next_bookmark_order(session, uid)
        if src.status in _RAN_STATUSES:
            copy.ran_at = utcnow()
    else:
        _check_project(session, payload.project_id, uid)
        copy = Prompt(
            user_id=uid,
            title=src.title,
            body=src.body,
            project_id=payload.project_id,
            status=PromptStatus.queued,
            sort_order=_next_sort_order(session, PromptStatus.queued, uid),
        )
    session.add(copy)
    session.flush()  # assign copy.id for the cloned attachments
    TagService(session).copy_to_prompt(src, copy, uid=uid)

    for att in session.exec(select(Attachment).where(Attachment.prompt_id == src.id)).all():
        new_name = clone_attachment_file(att)
        if new_name is None:
            continue  # source file already expired/missing -> skip silently
        session.add(
            Attachment(
                user_id=uid,
                prompt_id=copy.id,
                filename=new_name,
                original_name=att.original_name,
                content_type=att.content_type,
                size=att.size,
                created_at=utcnow(),
            )
        )

    events.record(session, copy, PromptEventType.created)
    session.commit()
    session.refresh(copy)
    return _read(session, copy)


@router.post("/merge", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def merge_prompts(
    payload: MergeRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Prompt:
    """Combine several of the caller's prompts into one new prompt.

    The client composes the merged body/order/format; the server creates the new
    prompt and then deletes / archives / keeps the sources — all in one commit.
    """
    if len(payload.source_ids) < 2:
        raise HTTPException(status_code=400, detail="Select at least two prompts to merge")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Body required")
    _check_project(session, payload.project_id, uid)

    sources: list[Prompt] = []
    for sid in payload.source_ids:
        prompt = session.get(Prompt, sid)
        if not prompt or prompt.user_id != uid:
            raise HTTPException(status_code=404, detail="Prompt not found")
        sources.append(prompt)

    merged = Prompt(
        user_id=uid,
        title=_derive_title(payload.title, payload.body),
        body=payload.body,
        project_id=payload.project_id,
        status=payload.status,
        sort_order=_next_sort_order(session, payload.status, uid),
    )
    if payload.status in _RAN_STATUSES:
        merged.ran_at = utcnow()
    session.add(merged)
    session.flush()  # assign merged.id for attachment reassignment
    TagService(session).set_for_prompt(merged, payload.tags, uid=uid)

    if payload.originals == "delete":
        for prompt in sources:
            # Carry each source's screenshots over to the merged prompt.
            for att in session.exec(
                select(Attachment).where(Attachment.prompt_id == prompt.id)
            ).all():
                att.prompt_id = merged.id
                session.add(att)
            _detach_references(session, prompt.id)
            events.record(session, prompt, PromptEventType.deleted)
            session.delete(prompt)
    elif payload.originals == "archive":
        next_arch = _next_sort_order(session, PromptStatus.archived, uid)
        for prompt in sources:
            if prompt.status != PromptStatus.archived:
                prompt.status = PromptStatus.archived
                prompt.sort_order = next_arch
                next_arch += 1
                prompt.updated_at = utcnow()
                session.add(prompt)
                events.record(session, prompt, PromptEventType.status_changed)
    # "keep" -> sources are left untouched.

    events.record(session, merged, PromptEventType.created)
    session.commit()
    session.refresh(merged)
    return _read(session, merged)


@router.post("/reorder", response_model=list[PromptRead])
def reorder_prompts(
    payload: ReorderRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[Prompt]:
    """Apply drag results in a single transaction.

    Each item carries its (possibly new) status and sort_order. A status change
    here also stamps ran_at the first time the prompt enters running/done.
    Only the caller's own prompts are touched.
    """
    touched: list[Prompt] = []
    for item in payload.items:
        prompt = session.get(Prompt, item.id)
        if not prompt or prompt.user_id != uid:
            continue
        if prompt.status != item.status:
            prompt.status = item.status
            # Blocked only exists on queued prompts — leaving queued clears it.
            if item.status != PromptStatus.queued:
                prompt.blocked = False
            # Tested only exists on done prompts — leaving done clears it.
            if item.status != PromptStatus.done:
                prompt.tested = False
            if item.status in _RAN_STATUSES and prompt.ran_at is None:
                prompt.ran_at = utcnow()
            events.record(session, prompt, PromptEventType.status_changed)
        prompt.sort_order = item.sort_order
        prompt.updated_at = utcnow()
        session.add(prompt)
        touched.append(prompt)
    session.commit()
    for prompt in touched:
        session.refresh(prompt)
    return _reads(session, touched)


@router.post("/bookmarks/reorder", response_model=list[PromptRead])
def reorder_bookmarks(
    payload: BookmarkReorderRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[Prompt]:
    """Apply a drag-sort of the bookmarks section in one transaction."""
    touched: list[Prompt] = []
    for item in payload.items:
        prompt = session.get(Prompt, item.id)
        if not prompt or prompt.user_id != uid:
            continue
        prompt.bookmark_order = item.bookmark_order
        session.add(prompt)
        touched.append(prompt)
    session.commit()
    for prompt in touched:
        session.refresh(prompt)
    return _reads(session, touched)
