"""Snippet library: editing workbench for Inspector-Rust (IR) AI-prompt snippets.

Import an IR backup JSON, structure/edit the snippets in cue, export them back
as an IR backup that "Settings → Backup & restore → Import" reads — a lossless
roundtrip. Format contract lives in `app.ir_format` (pure, tested separately).

Tenant rules match `routers/prompts.py`: every query filters by
`current_user_id`, ownership is re-checked on get/update/delete (404 if
foreign), CSRF on every mutating route.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..ir_format import IRFormatError, build_ir_backup, parse_ir_backup
from ..models import Snippet, SnippetGroup, utcnow
from ..schemas import (
    SnippetBulkDeleteRequest,
    SnippetBulkMoveRequest,
    SnippetCreate,
    SnippetGroupCreate,
    SnippetGroupRead,
    SnippetGroupReorderRequest,
    SnippetGroupUpdate,
    SnippetImportResult,
    SnippetRead,
    SnippetReorderRequest,
    SnippetUpdate,
)

router = APIRouter(prefix="/snippets", tags=["snippets"])

_MAX_IMPORT_BYTES = 10 * 1024 * 1024


def _to_ms(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _from_ms(ms: int | None) -> datetime | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _owned(session: Session, snippet_id: int, uid: int) -> Snippet:
    snippet = session.get(Snippet, snippet_id)
    if not snippet or snippet.user_id != uid:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return snippet


def _owned_group(session: Session, group_id: int, uid: int) -> SnippetGroup:
    group = session.get(SnippetGroup, group_id)
    if not group or group.user_id != uid:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _abbreviation_taken(
    session: Session, uid: int, abbreviation: str, exclude_id: int | None = None
) -> bool:
    stmt = select(Snippet).where(
        Snippet.user_id == uid, Snippet.abbreviation == abbreviation
    )
    existing = session.exec(stmt).first()
    return existing is not None and existing.id != exclude_id


def _next_snippet_order(session: Session, uid: int, group_name: str | None) -> int:
    current_max = session.exec(
        select(func.max(Snippet.sort_order)).where(
            Snippet.user_id == uid, Snippet.group_name == group_name
        )
    ).one()
    return (current_max or 0) + 1


def _next_group_order(session: Session, uid: int) -> int:
    current_max = session.exec(
        select(func.max(SnippetGroup.sort_order)).where(SnippetGroup.user_id == uid)
    ).one()
    return (current_max or 0) + 1


def _get_or_create_group(session: Session, uid: int, name: str) -> tuple[SnippetGroup, bool]:
    group = session.exec(
        select(SnippetGroup).where(SnippetGroup.user_id == uid, SnippetGroup.name == name)
    ).first()
    if group:
        return group, False
    group = SnippetGroup(user_id=uid, name=name, sort_order=_next_group_order(session, uid))
    session.add(group)
    session.flush()
    return group, True


def _resolve_group_name(session: Session, uid: int, raw: str | None) -> str | None:
    """Normalize an incoming group assignment: '' / None -> ungrouped; a name
    is get-or-created so assignment and group list never diverge."""
    name = (raw or "").strip()
    if not name:
        return None
    _get_or_create_group(session, uid, name)
    return name


# ---- Groups (registered before /{snippet_id} so the paths never collide) ----
@router.get("/groups", response_model=list[SnippetGroupRead])
def list_groups(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[SnippetGroup]:
    return session.exec(
        select(SnippetGroup)
        .where(SnippetGroup.user_id == uid)
        .order_by(SnippetGroup.sort_order, SnippetGroup.id)
    ).all()


@router.post("/groups", response_model=SnippetGroupRead, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: SnippetGroupCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> SnippetGroup:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    group, created = _get_or_create_group(session, uid, name)
    if not created:
        raise HTTPException(status_code=409, detail="Group already exists")
    session.commit()
    session.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=SnippetGroupRead)
def rename_group(
    group_id: int,
    payload: SnippetGroupUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> SnippetGroup:
    group = _owned_group(session, group_id, uid)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    duplicate = session.exec(
        select(SnippetGroup).where(SnippetGroup.user_id == uid, SnippetGroup.name == name)
    ).first()
    if duplicate and duplicate.id != group.id:
        raise HTTPException(status_code=409, detail="Group already exists")
    old_name = group.name
    group.name = name
    session.add(group)
    # Back-fill the denormalized column in the same transaction.
    for snippet in session.exec(
        select(Snippet).where(Snippet.user_id == uid, Snippet.group_name == old_name)
    ).all():
        snippet.group_name = name
        session.add(snippet)
    session.commit()
    session.refresh(group)
    return group


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    group = _owned_group(session, group_id, uid)
    # Members become ungrouped; the snippets themselves survive.
    for snippet in session.exec(
        select(Snippet).where(Snippet.user_id == uid, Snippet.group_name == group.name)
    ).all():
        snippet.group_name = None
        session.add(snippet)
    session.delete(group)
    session.commit()


@router.post("/groups/reorder", response_model=list[SnippetGroupRead])
def reorder_groups(
    payload: SnippetGroupReorderRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[SnippetGroup]:
    touched: list[SnippetGroup] = []
    for item in payload.items:
        group = session.get(SnippetGroup, item.id)
        if not group or group.user_id != uid:
            continue
        group.sort_order = item.sort_order
        session.add(group)
        touched.append(group)
    session.commit()
    for group in touched:
        session.refresh(group)
    return touched


# ---- Import / Export ----
@router.post("/import", response_model=SnippetImportResult)
async def import_backup(
    request: Request,
    file: UploadFile | None = File(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> SnippetImportResult:
    """Import an IR backup (multipart file or raw JSON body). Merge semantics:
    upsert per (user, abbreviation); `category: ""` ungroupes, `category: null`
    leaves an existing assignment untouched (mirrors IR's own import rule)."""
    if file is not None:
        raw_bytes = await file.read()
    else:
        raw_bytes = await request.body()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Keine Datei übergeben")
    if len(raw_bytes) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß")
    try:
        parsed = parse_ir_backup(raw_bytes.decode("utf-8", "replace"))
    except IRFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    groups_created = 0
    # snippet_categories first: EMPTY groups + their order must survive.
    for name, _order in parsed.categories:
        _, created = _get_or_create_group(session, uid, name)
        if created:
            groups_created += 1

    imported = updated = 0
    for item in parsed.snippets:
        existing = session.exec(
            select(Snippet).where(
                Snippet.user_id == uid, Snippet.abbreviation == item.abbreviation
            )
        ).first()
        if item.category is None:
            group_name = existing.group_name if existing else None
        elif item.category == "":
            group_name = None
        else:
            group, created = _get_or_create_group(session, uid, item.category)
            if created:
                groups_created += 1
            group_name = group.name
        if existing:
            if item.title != existing.title or item.body != existing.body:
                existing.version += 1  # content revision via import merge
            existing.title = item.title
            existing.body = item.body
            existing.group_name = group_name
            existing.updated_at = _from_ms(item.updated_at_ms) or utcnow()
            session.add(existing)
            updated += 1
        else:
            session.add(
                Snippet(
                    user_id=uid,
                    abbreviation=item.abbreviation,
                    title=item.title,
                    body=item.body,
                    group_name=group_name,
                    sort_order=_next_snippet_order(session, uid, group_name),
                    created_at=_from_ms(item.created_at_ms) or utcnow(),
                    updated_at=_from_ms(item.updated_at_ms) or utcnow(),
                )
            )
            imported += 1
        session.flush()

    session.commit()
    return SnippetImportResult(
        imported=imported,
        updated=updated,
        groups_created=groups_created,
        skipped=parsed.skipped,
        errors=parsed.errors,
    )


@router.get("/export")
def export_backup(
    groups: str | None = Query(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> JSONResponse:
    """Download the user's snippets as an IR backup. `?groups=a,b` narrows the
    export to those groups; without it everything (incl. EMPTY groups) goes."""
    wanted: set[str] | None = None
    if groups is not None:
        wanted = {g.strip() for g in groups.split(",") if g.strip()}

    group_rows = session.exec(
        select(SnippetGroup)
        .where(SnippetGroup.user_id == uid)
        .order_by(SnippetGroup.sort_order, SnippetGroup.id)
    ).all()
    group_names = [g.name for g in group_rows if wanted is None or g.name in wanted]

    stmt = select(Snippet).where(Snippet.user_id == uid)
    snippets = [
        s
        for s in session.exec(
            stmt.order_by(Snippet.group_name, Snippet.sort_order, Snippet.id)
        ).all()
        if wanted is None or (s.group_name or "") in wanted
    ]

    now_ms = int(time.time() * 1000)
    doc = build_ir_backup(
        [
            {
                "abbreviation": s.abbreviation,
                "title": s.title,
                "body": s.body,
                "group_name": s.group_name,
                "created_at_ms": _to_ms(s.created_at),
                "updated_at_ms": _to_ms(s.updated_at),
            }
            for s in snippets
        ],
        group_names,
        now_ms,
    )
    filename = f"ir-snippets-{datetime.now(timezone.utc):%Y-%m-%d}.json"
    return JSONResponse(
        doc, headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ---- Snippet CRUD / reorder / bulk ----
@router.get("", response_model=list[SnippetRead])
def list_snippets(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[Snippet]:
    return session.exec(
        select(Snippet)
        .where(Snippet.user_id == uid)
        .order_by(Snippet.group_name, Snippet.sort_order, Snippet.id)
    ).all()


@router.post("", response_model=SnippetRead, status_code=status.HTTP_201_CREATED)
def create_snippet(
    payload: SnippetCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Snippet:
    abbreviation = payload.abbreviation.strip()
    if not abbreviation:
        raise HTTPException(status_code=400, detail="Abkürzung erforderlich")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Body erforderlich")
    if _abbreviation_taken(session, uid, abbreviation):
        raise HTTPException(status_code=409, detail="Abkürzung existiert bereits")
    group_name = _resolve_group_name(session, uid, payload.group_name)
    snippet = Snippet(
        user_id=uid,
        abbreviation=abbreviation,
        title=payload.title.strip(),
        body=payload.body,
        group_name=group_name,
        sort_order=_next_snippet_order(session, uid, group_name),
    )
    session.add(snippet)
    session.commit()
    session.refresh(snippet)
    return snippet


@router.get("/{snippet_id}", response_model=SnippetRead)
def get_snippet(
    snippet_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> Snippet:
    return _owned(session, snippet_id, uid)


@router.patch("/{snippet_id}", response_model=SnippetRead)
def update_snippet(
    snippet_id: int,
    payload: SnippetUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> Snippet:
    snippet = _owned(session, snippet_id, uid)
    content_changed = False
    if payload.abbreviation is not None:
        abbreviation = payload.abbreviation.strip()
        if not abbreviation:
            raise HTTPException(status_code=400, detail="Abkürzung erforderlich")
        if _abbreviation_taken(session, uid, abbreviation, exclude_id=snippet.id):
            raise HTTPException(status_code=409, detail="Abkürzung existiert bereits")
        if abbreviation != snippet.abbreviation:
            content_changed = True
        snippet.abbreviation = abbreviation
    if payload.title is not None:
        if payload.title.strip() != snippet.title:
            content_changed = True
        snippet.title = payload.title.strip()
    if payload.body is not None:
        if not payload.body.strip():
            raise HTTPException(status_code=400, detail="Body erforderlich")
        if payload.body != snippet.body:
            content_changed = True
        snippet.body = payload.body
    if content_changed:
        snippet.version += 1
    if payload.group_name is not None:
        new_group = _resolve_group_name(session, uid, payload.group_name)
        if new_group != snippet.group_name:
            snippet.group_name = new_group
            snippet.sort_order = _next_snippet_order(session, uid, new_group)
    snippet.updated_at = utcnow()
    session.add(snippet)
    session.commit()
    session.refresh(snippet)
    return snippet


@router.delete("/{snippet_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_snippet(
    snippet_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    snippet = _owned(session, snippet_id, uid)
    session.delete(snippet)
    session.commit()


@router.post("/reorder", response_model=list[SnippetRead])
def reorder_snippets(
    payload: SnippetReorderRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[Snippet]:
    """Apply drag results (within a group or across groups) in one transaction."""
    touched: list[Snippet] = []
    for item in payload.items:
        snippet = session.get(Snippet, item.id)
        if not snippet or snippet.user_id != uid:
            continue
        group_name = _resolve_group_name(session, uid, item.group_name)
        snippet.group_name = group_name
        snippet.sort_order = item.sort_order
        snippet.updated_at = utcnow()
        session.add(snippet)
        touched.append(snippet)
    session.commit()
    for snippet in touched:
        session.refresh(snippet)
    return touched


@router.post("/bulk-move", response_model=list[SnippetRead])
def bulk_move(
    payload: SnippetBulkMoveRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[Snippet]:
    group_name = _resolve_group_name(session, uid, payload.group_name)
    touched: list[Snippet] = []
    for sid in payload.ids:
        snippet = session.get(Snippet, sid)
        if not snippet or snippet.user_id != uid:
            continue
        snippet.group_name = group_name
        snippet.sort_order = _next_snippet_order(session, uid, group_name)
        snippet.updated_at = utcnow()
        session.add(snippet)
        session.flush()
        touched.append(snippet)
    session.commit()
    for snippet in touched:
        session.refresh(snippet)
    return touched


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete(
    payload: SnippetBulkDeleteRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    for sid in payload.ids:
        snippet = session.get(Snippet, sid)
        if snippet and snippet.user_id == uid:
            session.delete(snippet)
    session.commit()
