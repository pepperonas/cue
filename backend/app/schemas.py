"""Pydantic request/response schemas (separate from table models)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from .models import PromptStatus


# ---- Auth ----
class UserRead(BaseModel):
    email: str
    name: str = ""
    picture: str = ""


class MeResponse(BaseModel):
    authenticated: bool
    csrf_token: str | None = None
    user: UserRead | None = None


# ---- Projects ----
class ProjectCreate(BaseModel):
    name: str
    color: str = "#6750A4"


class ProjectUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class ProjectRead(BaseModel):
    id: int
    name: str
    color: str
    created_at: datetime
    prompt_count: int = 0


# ---- Prompts ----
class PromptCreate(BaseModel):
    title: str = ""
    body: str
    project_id: int | None = None
    status: PromptStatus = PromptStatus.queued
    tags: str = ""


class PromptUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    project_id: int | None = None
    status: PromptStatus | None = None
    tags: str | None = None
    bookmarked: bool | None = None
    # Sentinel to allow explicitly clearing project_id (set unassign=True).
    unassign_project: bool = False


class PromptRead(BaseModel):
    id: int
    title: str
    body: str
    project_id: int | None
    status: PromptStatus
    sort_order: int
    tags: str
    bookmarked: bool
    bookmark_order: int
    created_at: datetime
    updated_at: datetime
    ran_at: datetime | None


class ReorderItem(BaseModel):
    id: int
    status: PromptStatus
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


class BookmarkReorderItem(BaseModel):
    id: int
    bookmark_order: int


class BookmarkReorderRequest(BaseModel):
    items: list[BookmarkReorderItem]
