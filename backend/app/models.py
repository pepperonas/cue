"""SQLModel table definitions: Project and Prompt."""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PromptStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"
    archived = "archived"


class Project(SQLModel, table=True):
    __tablename__ = "project"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    # MD3 tonal seed color (hex, e.g. "#6750A4"). Drives the project badge tint.
    color: str = Field(default="#6750A4")
    created_at: datetime = Field(default_factory=utcnow)


class Prompt(SQLModel, table=True):
    __tablename__ = "prompt"

    id: int | None = Field(default=None, primary_key=True)
    # Optional title; when empty the client/server derives it from the body.
    title: str = Field(default="")
    body: str = Field(default="")
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    status: PromptStatus = Field(default=PromptStatus.queued, index=True)
    # Position within its status column / list. Lower = higher up.
    sort_order: int = Field(default=0, index=True)
    # Simple comma-separated tags.
    tags: str = Field(default="")
    # Bookmarking: pinned prompts get their own drag-sortable section.
    bookmarked: bool = Field(default=False, index=True)
    # Position within the bookmarks section. Lower = higher up.
    bookmark_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    # Set when the prompt first enters running/done.
    ran_at: datetime | None = Field(default=None)
