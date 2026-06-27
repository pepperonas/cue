"""Import (.txt) and export (JSON backup / ZIP of .txt files) endpoints."""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Project, Prompt, PromptStatus
from ..schemas import PromptRead

router = APIRouter(tags=["import-export"])


def _now() -> datetime:
    return datetime.now(timezone.utc)

# Default: split on a markdown horizontal rule on its own line.
_DEFAULT_DELIMITER = "\n---\n"


def _slugify(text: str, fallback: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip()).strip("-").lower()
    return slug[:60] or fallback


def _split_blocks(content: str, delimiter: str) -> list[str]:
    if delimiter == "blank":
        # Split on one or more fully blank lines (paragraph groups).
        parts = re.split(r"\n\s*\n", content)
    else:
        parts = content.split(delimiter)
    return [p.strip() for p in parts if p.strip()]


@router.post("/import", response_model=list[PromptRead])
async def import_txt(
    files: list[UploadFile],
    split_delimiter: str = Form(default="none"),
    project_id: int | None = Form(default=None),
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[Prompt]:
    """Import one or more .txt files into prompts.

    split_delimiter:
      - "none"  -> one prompt per file
      - "rule"  -> split on a line containing only '---'
      - "blank" -> split on blank-line-separated paragraph groups
      - any other literal string is used verbatim as the delimiter
    """
    if project_id is not None:
        project = session.get(Project, project_id)
        if not project or project.user_id != uid:
            raise HTTPException(status_code=400, detail="Unknown project")

    # Resolve the next sort_order for the queued column once, then increment.
    max_order = session.exec(
        select(Prompt.sort_order)
        .where(Prompt.status == PromptStatus.queued, Prompt.user_id == uid)
        .order_by(Prompt.sort_order.desc())
    ).first()
    next_order = (max_order or 0) + 1

    created: list[Prompt] = []
    for upload in files:
        raw = (await upload.read()).decode("utf-8", errors="replace")
        if split_delimiter == "none":
            blocks = [raw.strip()] if raw.strip() else []
        elif split_delimiter == "rule":
            blocks = _split_blocks(raw, _DEFAULT_DELIMITER)
        elif split_delimiter == "blank":
            blocks = _split_blocks(raw, "blank")
        else:
            blocks = _split_blocks(raw, split_delimiter)

        for block in blocks:
            first_line = next((ln.strip() for ln in block.splitlines() if ln.strip()), "")
            title = first_line.lstrip("#").strip()[:120] or (upload.filename or "Imported")
            prompt = Prompt(
                user_id=uid,
                title=title,
                body=block,
                project_id=project_id,
                status=PromptStatus.queued,
                sort_order=next_order,
            )
            next_order += 1
            session.add(prompt)
            created.append(prompt)

    session.commit()
    for prompt in created:
        session.refresh(prompt)
    return created


@router.get("/export")
def export_json(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> JSONResponse:
    """Full JSON backup of the caller's projects + prompts."""
    projects = session.exec(select(Project).where(Project.user_id == uid)).all()
    prompts = session.exec(select(Prompt).where(Prompt.user_id == uid)).all()
    payload = {
        "version": 1,
        "exported_at": _now().isoformat(),
        "projects": [json.loads(p.model_dump_json()) for p in projects],
        "prompts": [json.loads(p.model_dump_json()) for p in prompts],
    }
    stamp = _now().strftime("%Y%m%d-%H%M%S")
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="cue-backup-{stamp}.json"'},
    )


@router.get("/export/txt")
def export_txt_zip(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> StreamingResponse:
    """ZIP archive with one .txt file per prompt, foldered by project."""
    projects = {p.id: p.name for p in session.exec(select(Project).where(Project.user_id == uid)).all()}
    prompts = session.exec(
        select(Prompt).where(Prompt.user_id == uid).order_by(Prompt.status, Prompt.sort_order)
    ).all()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        seen: set[str] = set()
        for prompt in prompts:
            folder = _slugify(projects.get(prompt.project_id, ""), "unassigned")
            base = _slugify(prompt.title, f"prompt-{prompt.id}")
            name = f"{folder}/{prompt.id:04d}-{base}.txt"
            if name in seen:
                name = f"{folder}/{prompt.id:04d}-{base}-{len(seen)}.txt"
            seen.add(name)
            zf.writestr(name, prompt.body)

    buffer.seek(0)
    stamp = _now().strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="cue-prompts-{stamp}.zip"'},
    )
