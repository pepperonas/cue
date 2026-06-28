"""Image attachment endpoints: upload, serve, delete (scoped to the user)."""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Attachment, utcnow
from ..schemas import AttachmentRead

router = APIRouter(prefix="/attachments", tags=["attachments"])
_settings = get_settings()

_ALLOWED = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}


def attachment_read(a: Attachment) -> AttachmentRead:
    return AttachmentRead(
        id=a.id,
        url=f"/api/attachments/{a.id}",
        name=a.original_name,
        content_type=a.content_type,
        size=a.size,
    )


def attachment_path(a: Attachment) -> Path:
    return (Path(_settings.attachments_dir) / a.filename).resolve()


def delete_attachment_file(a: Attachment) -> None:
    try:
        attachment_path(a).unlink(missing_ok=True)
    except OSError:
        pass


@router.post("", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    file: UploadFile,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> AttachmentRead:
    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _settings.max_attachment_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    ext = Path(file.filename or "").suffix.lower() or (
        mimetypes.guess_extension(content_type) or ".bin"
    )
    stored = f"{uuid.uuid4().hex}{ext}"
    Path(_settings.attachments_dir).mkdir(parents=True, exist_ok=True)
    (Path(_settings.attachments_dir) / stored).write_bytes(data)

    att = Attachment(
        user_id=uid,
        prompt_id=None,
        filename=stored,
        original_name=(file.filename or "screenshot")[:200],
        content_type=content_type,
        size=len(data),
        created_at=utcnow(),
    )
    session.add(att)
    session.commit()
    session.refresh(att)
    return attachment_read(att)


@router.get("", response_model=list[AttachmentRead])
def list_attachments(
    prompt_id: int = Query(...),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[AttachmentRead]:
    rows = session.exec(
        select(Attachment).where(
            Attachment.prompt_id == prompt_id, Attachment.user_id == uid
        )
    ).all()
    return [attachment_read(a) for a in rows]


@router.get("/{attachment_id}")
def get_attachment(
    attachment_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> FileResponse:
    att = session.get(Attachment, attachment_id)
    if not att or att.user_id != uid:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = attachment_path(att)
    base = Path(_settings.attachments_dir).resolve()
    if not path.is_file() or not path.is_relative_to(base):
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(path, media_type=att.content_type, filename=att.original_name)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    att = session.get(Attachment, attachment_id)
    if not att or att.user_id != uid:
        raise HTTPException(status_code=404, detail="Attachment not found")
    delete_attachment_file(att)
    session.delete(att)
    session.commit()
