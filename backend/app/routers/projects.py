"""Project CRUD endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_session, require_csrf
from ..models import Project, Prompt
from ..schemas import ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _to_read(project: Project, count: int) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        name=project.name,
        color=project.color,
        created_at=project.created_at,
        prompt_count=count,
    )


@router.get("", response_model=list[ProjectRead])
def list_projects(
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
) -> list[ProjectRead]:
    counts = dict(
        session.exec(
            select(Prompt.project_id, func.count(Prompt.id)).group_by(Prompt.project_id)
        ).all()
    )
    projects = session.exec(select(Project).order_by(Project.name)).all()
    return [_to_read(p, counts.get(p.id, 0)) for p in projects]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> ProjectRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if session.exec(select(Project).where(Project.name == name)).first():
        raise HTTPException(status_code=409, detail="Project name already exists")
    project = Project(name=name, color=payload.color)
    session.add(project)
    session.commit()
    session.refresh(project)
    return _to_read(project, 0)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> ProjectRead:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Name required")
        clash = session.exec(
            select(Project).where(Project.name == new_name, Project.id != project_id)
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Project name already exists")
        project.name = new_name
    if payload.color is not None:
        project.color = payload.color
    session.add(project)
    session.commit()
    session.refresh(project)
    count = session.exec(
        select(func.count(Prompt.id)).where(Prompt.project_id == project_id)
    ).one()
    return _to_read(project, count)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    session: Session = Depends(get_session),
    _s: dict = Depends(current_session),
    _csrf: None = Depends(require_csrf),
) -> None:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Unassign prompts rather than deleting them.
    prompts = session.exec(select(Prompt).where(Prompt.project_id == project_id)).all()
    for prompt in prompts:
        prompt.project_id = None
        session.add(prompt)
    session.delete(project)
    session.commit()
