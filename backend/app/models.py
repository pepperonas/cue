"""SQLModel table definitions: Project, Prompt, attachments, and the run engine."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return uuid.uuid4().hex


class PromptStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"
    archived = "archived"


class User(SQLModel, table=True):
    __tablename__ = "user"

    id: int | None = Field(default=None, primary_key=True)
    # Google's stable subject identifier (the trusted account key).
    google_sub: str = Field(index=True, unique=True)
    email: str = Field(index=True)
    name: str = Field(default="")
    picture: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: datetime = Field(default_factory=utcnow)
    # Per-user prompt-capture config (multi-tenant): own token + project base.
    capture_token: str | None = Field(default=None, index=True)
    project_base: str | None = Field(default=None)
    # Admin approval: sign-in is open (Google), data access only once approved.
    # Allowlisted emails/domains and the owner are auto-approved on login.
    approved: bool = Field(default=False)


class Project(SQLModel, table=True):
    __tablename__ = "project"

    id: int | None = Field(default=None, primary_key=True)
    # Owning tenant. Nullable only for legacy rows pending the owner-claim migration.
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    name: str = Field(index=True)
    # MD3 tonal seed color (hex, e.g. "#6750A4"). Drives the project badge tint.
    color: str = Field(default="#6750A4")
    # Manual ordering (drag-sortable); also drives the filter-chip order.
    sort_order: int = Field(default=0, index=True)
    created_at: datetime = Field(default_factory=utcnow)


class Prompt(SQLModel, table=True):
    __tablename__ = "prompt"

    id: int | None = Field(default=None, primary_key=True)
    # Owning tenant. Nullable only for legacy rows pending the owner-claim migration.
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
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
    # Whether the feature this prompt produced has been tested (running/done only).
    tested: bool = Field(default=False)
    # Blocked prompts sink to the bottom of their column and refuse running/done.
    blocked: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    # Set when the prompt first enters running/done.
    ran_at: datetime | None = Field(default=None)


class Attachment(SQLModel, table=True):
    __tablename__ = "attachment"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    # Null while pending (uploaded in the composer before the prompt is saved).
    prompt_id: int | None = Field(default=None, foreign_key="prompt.id", index=True)
    filename: str = Field(default="")  # stored name on disk
    original_name: str = Field(default="")
    content_type: str = Field(default="application/octet-stream")
    size: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)


# ---- Run engine ----
class RunKind(str, enum.Enum):
    single = "single"
    chain = "chain"


class RunStatus(str, enum.Enum):
    queued = "queued"
    claiming = "claiming"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


# Statuses a run/step can no longer leave.
RUN_TERMINAL = {RunStatus.succeeded, RunStatus.failed, RunStatus.canceled}


class Run(SQLModel, table=True):
    __tablename__ = "run"

    id: str = Field(default_factory=new_uuid, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    kind: RunKind = Field(default=RunKind.single)
    project_path: str = Field(default="")
    status: RunStatus = Field(default=RunStatus.queued, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    started_at: datetime | None = Field(default=None)
    finished_at: datetime | None = Field(default=None)

    # Claude session shared across all steps of a chain.
    claude_session_id: str | None = Field(default=None)
    # CLI options.
    model: str | None = Field(default=None)
    allowed_tools: str | None = Field(default=None)
    permission_mode: str | None = Field(default=None)
    bare: bool = Field(default=False)
    skip_permissions: bool = Field(default=False)
    max_turns: int | None = Field(default=None)
    stop_on_error: bool = Field(default=True)

    runner_id: str | None = Field(default=None)
    last_heartbeat: datetime | None = Field(default=None)
    cancel_requested: bool = Field(default=False)
    total_cost_usd: float | None = Field(default=None)
    error: str | None = Field(default=None)


class RunStep(SQLModel, table=True):
    __tablename__ = "run_step"

    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="run.id", index=True)
    step_index: int = Field(default=0)
    # Reference to the source prompt (may be deleted later) + a snapshot of its
    # text so the run stays reproducible.
    prompt_id: int | None = Field(default=None, foreign_key="prompt.id")
    prompt_text: str = Field(default="")
    status: RunStatus = Field(default=RunStatus.queued)
    claude_session_id: str | None = Field(default=None)
    output: str | None = Field(default=None)
    exit_code: int | None = Field(default=None)
    cost_usd: float | None = Field(default=None)
    started_at: datetime | None = Field(default=None)
    finished_at: datetime | None = Field(default=None)


class RunLog(SQLModel, table=True):
    __tablename__ = "run_log"

    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="run.id", index=True)
    step_index: int = Field(default=0)
    seq: int = Field(default=0, index=True)
    ts: datetime = Field(default_factory=utcnow)
    event_type: str = Field(default="")
    line: str = Field(default="")


# ---- Prompt capture (every prompt typed in the Claude Code CLI) ----
class CaptureSession(SQLModel, table=True):
    __tablename__ = "capture_session"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    # Claude Code session id (from the UserPromptSubmit hook).
    claude_session_id: str = Field(index=True)
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    cwd: str = Field(default="")
    started_at: datetime = Field(default_factory=utcnow)
    last_at: datetime = Field(default_factory=utcnow, index=True)
    prompt_count: int = Field(default=0)
    # Live terminal context (learned from the hook) so cue can send a prompt
    # back into this session's terminal. Updated on every capture.
    term_program: str = Field(default="")
    iterm_session_id: str = Field(default="")
    tmux_pane: str = Field(default="")
    tmux_socket: str = Field(default="")


class CapturedPrompt(SQLModel, table=True):
    __tablename__ = "captured_prompt"

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="capture_session.id", index=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    # Client-provided monotonic sequence within the Claude session (dedup key).
    seq: int = Field(default=0)
    text: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow)


class DeliveryStatus(str, enum.Enum):
    queued = "queued"
    sending = "sending"  # claimed by the runner, in flight
    sent = "sent"
    failed = "failed"


class CliDelivery(SQLModel, table=True):
    """A request to type a prompt into a live capture session's terminal.
    Owner-only (executes on the runner's machine); the runner claims & performs it."""

    __tablename__ = "cli_delivery"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    session_id: int = Field(foreign_key="capture_session.id", index=True)
    text: str = Field(default="")
    submit: bool = Field(default=False)  # press Enter after inserting
    status: DeliveryStatus = Field(default=DeliveryStatus.queued, index=True)
    error: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    sent_at: datetime | None = Field(default=None)


class SnippetGroup(SQLModel, table=True):
    """A named snippet group. Exists as its own table ONLY so empty groups and
    the group order survive (snippets denormalize the name in `group_name`)."""

    __tablename__ = "snippet_group"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    # No index on name: tiny per-user table, and SQLModel's auto index name
    # would collide with snippet.group_name's (ix_snippet_group_name).
    name: str = Field(default="")
    sort_order: int = Field(default=0)


class Snippet(SQLModel, table=True):
    """An Inspector-Rust text snippet (abbreviation -> body expansion).

    `abbreviation` is IR's merge key — unique per tenant (enforced in the
    router, like Project.name). `group_name` mirrors the SnippetGroup name so
    list/export never need a join; a group rename back-fills it in one txn."""

    __tablename__ = "snippet"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    abbreviation: str = Field(index=True)
    title: str = Field(default="")
    body: str = Field(default="")
    group_name: str | None = Field(default=None, index=True)
    sort_order: int = Field(default=0)
    # Content revision: starts at 1, bumped when abbreviation/title/body change
    # (NOT on group moves/reorder — organizational changes aren't revisions).
    version: int = Field(default=1)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
