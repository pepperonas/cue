"""Project CRUD endpoints (scoped to the authenticated user)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlmodel import Session, select

from sqlalchemy import func as _func

from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import CaptureSession, Project, ProjectContext, Prompt
from ..projectcontext import fetch as context_fetch
from ..projectcontext.service import ProjectContextService
from ..schemas import (
    ProjectContextRead,
    ProjectCreate,
    ProjectReorderRequest,
    ProjectRead,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _context_read(row: ProjectContext | None, project: Project) -> ProjectContextRead | None:
    # A cache row for a repo the project no longer points at is history, not state.
    if row is None or not project.github_repo or row.repo != project.github_repo:
        return None
    return ProjectContextRead(
        repo=row.repo,
        ref=row.ref,
        head_sha=row.head_sha,
        chars=row.chars,
        fetched_at=row.fetched_at,
        error=row.error,
    )


def _to_read(project: Project, count: int, context: ProjectContext | None = None) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        name=project.name,
        color=project.color,
        sort_order=project.sort_order,
        created_at=project.created_at,
        prompt_count=count,
        github_repo=project.github_repo,
        github_ref=project.github_ref,
        context=_context_read(context, project),
    )


def _contexts(session: Session, uid: int) -> dict[int, ProjectContext]:
    rows = session.exec(select(ProjectContext).where(ProjectContext.user_id == uid)).all()
    return {r.project_id: r for r in rows}


def _apply_github(project: Project, repo: str | None, ref: str | None) -> bool:
    """Set the repo link from a payload. True when it changed."""
    before = (project.github_repo, project.github_ref)
    if repo is not None:
        repo = repo.strip().removeprefix("https://github.com/").removesuffix(".git").strip("/")
        if repo and not context_fetch.valid_repo(repo):
            raise HTTPException(status_code=400, detail="GitHub-Repo bitte als owner/name angeben")
        project.github_repo = repo or None
        if not repo:
            project.github_ref = None
    if ref is not None:
        ref = ref.strip()
        if ref and not context_fetch.valid_ref(ref):
            raise HTTPException(status_code=400, detail="Ungültiger Branch-Name")
        project.github_ref = (ref or None) if project.github_repo else None
    return before != (project.github_repo, project.github_ref)


def _owned(session: Session, project_id: int, uid: int) -> Project:
    project = session.get(Project, project_id)
    if not project or project.user_id != uid:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("", response_model=list[ProjectRead])
def list_projects(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[ProjectRead]:
    counts = dict(
        session.exec(
            select(Prompt.project_id, func.count(Prompt.id))
            .where(Prompt.user_id == uid)
            .group_by(Prompt.project_id)
        ).all()
    )
    projects = session.exec(
        select(Project).where(Project.user_id == uid).order_by(Project.sort_order, Project.name)
    ).all()
    contexts = _contexts(session, uid)
    return [_to_read(p, counts.get(p.id, 0), contexts.get(p.id)) for p in projects]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> ProjectRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if session.exec(
        select(Project).where(Project.user_id == uid, Project.name == name)
    ).first():
        raise HTTPException(status_code=409, detail="Project name already exists")
    next_order = (
        session.exec(
            select(_func.max(Project.sort_order)).where(Project.user_id == uid)
        ).one()
        or 0
    ) + 1
    project = Project(name=name, color=payload.color, user_id=uid, sort_order=next_order)
    changed = _apply_github(project, payload.github_repo, payload.github_ref)
    session.add(project)
    session.commit()
    session.refresh(project)
    service = ProjectContextService(session)
    if changed:
        service.safe_refresh(uid, project.id)
    return _to_read(project, 0, service.row(project.id))


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> ProjectRead:
    project = _owned(session, project_id, uid)
    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Name required")
        clash = session.exec(
            select(Project).where(
                Project.user_id == uid, Project.name == new_name, Project.id != project_id
            )
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Project name already exists")
        project.name = new_name
    if payload.color is not None:
        project.color = payload.color
    changed = _apply_github(project, payload.github_repo, payload.github_ref)
    session.add(project)
    session.commit()
    session.refresh(project)
    service = ProjectContextService(session)
    if changed:
        # Fetch right away, so the first run after linking already has context.
        service.safe_refresh(uid, project.id)
    count = session.exec(
        select(func.count(Prompt.id)).where(Prompt.project_id == project_id)
    ).one()
    return _to_read(project, count, service.row(project.id))


@router.post("/{project_id}/context/refresh", response_model=ProjectRead)
def refresh_project_context(
    project_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> ProjectRead:
    """Re-read the linked repository now (only refetches when the head moved)."""
    project = _owned(session, project_id, uid)
    if not project.github_repo:
        raise HTTPException(status_code=400, detail="Diesem Projekt ist kein GitHub-Repo zugeordnet")
    service = ProjectContextService(session)
    service.safe_refresh(uid, project_id)
    count = session.exec(
        select(func.count(Prompt.id)).where(Prompt.project_id == project_id)
    ).one()
    return _to_read(project, count, service.row(project_id))


@router.post("/reorder", response_model=list[ProjectRead])
def reorder_projects(
    payload: ProjectReorderRequest,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> list[ProjectRead]:
    """Apply a drag-sort of the caller's projects (also drives the filter chips)."""
    for item in payload.items:
        project = session.get(Project, item.id)
        if project and project.user_id == uid:
            project.sort_order = item.sort_order
            session.add(project)
    session.commit()
    projects = session.exec(
        select(Project).where(Project.user_id == uid).order_by(Project.sort_order, Project.name)
    ).all()
    counts = dict(
        session.exec(
            select(Prompt.project_id, func.count(Prompt.id))
            .where(Prompt.user_id == uid)
            .group_by(Prompt.project_id)
        ).all()
    )
    contexts = _contexts(session, uid)
    return [_to_read(p, counts.get(p.id, 0), contexts.get(p.id)) for p in projects]


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    project = _owned(session, project_id, uid)
    # Unassign prompts rather than deleting them.
    prompts = session.exec(
        select(Prompt).where(Prompt.project_id == project_id, Prompt.user_id == uid)
    ).all()
    for prompt in prompts:
        prompt.project_id = None
        session.add(prompt)
    # Capture sessions also FK the project (capture auto-creates projects per cwd);
    # unassign them too, or foreign_keys=ON raises on delete.
    sessions = session.exec(
        select(CaptureSession).where(
            CaptureSession.project_id == project_id, CaptureSession.user_id == uid
        )
    ).all()
    for cs in sessions:
        cs.project_id = None
        session.add(cs)
    ProjectContextService(session).delete_for_project(project_id)
    session.delete(project)
    session.commit()
