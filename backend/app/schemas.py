"""Pydantic request/response schemas (separate from table models)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .models import PromptStatus, RunKind, RunStatus


# ---- Auth ----
class UserRead(BaseModel):
    email: str
    name: str = ""
    picture: str = ""


class MeResponse(BaseModel):
    authenticated: bool
    approved: bool = True
    is_admin: bool = False
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
    sort_order: int = 0
    created_at: datetime
    prompt_count: int = 0


class ProjectReorderItem(BaseModel):
    id: int
    sort_order: int


class ProjectReorderRequest(BaseModel):
    items: list[ProjectReorderItem]


# ---- Attachments ----
class AttachmentRead(BaseModel):
    id: int
    url: str
    name: str
    content_type: str
    size: int


# ---- Prompts ----
class PromptCreate(BaseModel):
    title: str = ""
    body: str
    project_id: int | None = None
    status: PromptStatus = PromptStatus.queued
    tags: str = ""
    attachment_ids: list[int] = []


class PromptUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    project_id: int | None = None
    status: PromptStatus | None = None
    tags: str | None = None
    bookmarked: bool | None = None
    tested: bool | None = None
    blocked: bool | None = None
    # Additional attachments to associate with this prompt.
    attachment_ids: list[int] | None = None
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
    tested: bool
    blocked: bool
    created_at: datetime
    updated_at: datetime
    ran_at: datetime | None
    attachments: list[AttachmentRead] = []


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


class DuplicateRequest(BaseModel):
    # Target project for the copy (None = no project).
    project_id: int | None = None


class MergeRequest(BaseModel):
    # Prompts being merged (the client composes the final body/order/format).
    source_ids: list[int]
    title: str = ""
    body: str
    project_id: int | None = None
    status: PromptStatus = PromptStatus.queued
    tags: str = ""
    # What to do with the source prompts after the merge.
    originals: Literal["delete", "archive", "keep"] = "delete"


# ---- Run engine ----
class RunCreate(BaseModel):
    kind: RunKind = RunKind.single
    # Ordered prompt ids (single = exactly one, chain = two or more).
    prompt_ids: list[int]
    project_path: str
    model: str | None = None
    allowed_tools: str | None = None
    permission_mode: str | None = None
    bare: bool = False
    skip_permissions: bool = False
    max_turns: int | None = None
    stop_on_error: bool = True


class RunStepRead(BaseModel):
    id: int
    step_index: int
    prompt_id: int | None
    prompt_text: str
    status: RunStatus
    claude_session_id: str | None
    output: str | None
    exit_code: int | None
    cost_usd: float | None
    started_at: datetime | None
    finished_at: datetime | None


class RunLogRead(BaseModel):
    seq: int
    step_index: int
    ts: datetime
    event_type: str
    line: str


class RunRead(BaseModel):
    id: str
    kind: RunKind
    project_path: str
    status: RunStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    claude_session_id: str | None
    model: str | None
    allowed_tools: str | None
    permission_mode: str | None
    bare: bool
    skip_permissions: bool
    max_turns: int | None
    stop_on_error: bool
    runner_id: str | None
    last_heartbeat: datetime | None
    cancel_requested: bool
    total_cost_usd: float | None
    error: str | None
    # Step progress ("4/5 done") for list views without loading full details.
    steps_done: int = 0
    steps_total: int = 0


class RunDetailRead(RunRead):
    steps: list[RunStepRead] = []
    logs: list[RunLogRead] = []


class RunConfigRead(BaseModel):
    allowed_bases: list[str]
    permission_modes: list[str]
    models: list[str]


# ---- Runner-facing payloads ----
class ClaimRequest(BaseModel):
    runner_id: str | None = None


class HeartbeatResponse(BaseModel):
    status: RunStatus
    cancel_requested: bool


class RunLogLine(BaseModel):
    event_type: str = ""
    line: str = ""


class RunLogAppend(BaseModel):
    step_index: int = 0
    lines: list[RunLogLine] = []


class StepResultRequest(BaseModel):
    status: RunStatus
    claude_session_id: str | None = None
    output: str | None = None
    exit_code: int | None = None
    cost_usd: float | None = None


class RunResultRequest(BaseModel):
    status: RunStatus
    total_cost_usd: float | None = None
    error: str | None = None


# ---- Prompt capture ----
class CaptureItem(BaseModel):
    session_id: str          # Claude Code session id
    cwd: str = ""
    prompt: str
    seq: int = 0
    ts: float | None = None   # client epoch seconds (optional)
    # Git repo root of the cwd (hook-reported) for precise project derivation.
    git_root: str = ""
    # Live terminal context, so cue can later send prompts back into the session.
    term_program: str = ""
    iterm_session_id: str = ""
    tmux_pane: str = ""
    tmux_socket: str = ""


class CaptureRequest(BaseModel):
    items: list[CaptureItem]


class CaptureResult(BaseModel):
    stored: int
    skipped: int


class CapturedPromptRead(BaseModel):
    id: int
    seq: int
    text: str
    created_at: datetime


class CaptureSessionRead(BaseModel):
    id: int
    claude_session_id: str
    project_id: int | None
    project_name: str | None = None
    cwd: str
    started_at: datetime
    last_at: datetime
    prompt_count: int
    # True when cue knows a live terminal transport for this session (can send).
    deliverable: bool = False


class CaptureSessionDetail(CaptureSessionRead):
    prompts: list[CapturedPromptRead] = []


class CliSendRequest(BaseModel):
    text: str
    submit: bool = False  # press Enter after inserting the text


class CliDeliveryRead(BaseModel):
    """What the runner receives to perform one delivery."""

    id: int
    transport: str  # "iterm" | "tmux"
    iterm_session_id: str = ""
    tmux_pane: str = ""
    tmux_socket: str = ""
    text: str
    submit: bool = False


class CliDeliveryResult(BaseModel):
    status: str  # "sent" | "failed"
    error: str | None = None


class CaptureSettingsRead(BaseModel):
    project_base: str
    has_token: bool
    # Set only immediately after (re)generating a token, shown once.
    token: str | None = None


class CaptureSettingsUpdate(BaseModel):
    project_base: str | None = None
    regenerate: bool = False


# ---- Snippets (Inspector-Rust roundtrip workbench) ----
class SnippetCreate(BaseModel):
    abbreviation: str
    title: str = ""
    body: str
    # Group name; "" or None = ungrouped. Unknown names are created on the fly.
    group_name: str | None = None


class SnippetUpdate(BaseModel):
    abbreviation: str | None = None
    title: str | None = None
    body: str | None = None
    # Three-valued like IR: None = don't touch, "" = ungroup, name = assign.
    group_name: str | None = None


class SnippetRead(BaseModel):
    id: int
    abbreviation: str
    title: str
    body: str
    group_name: str | None
    sort_order: int
    version: int
    created_at: datetime
    updated_at: datetime


class SnippetGroupCreate(BaseModel):
    name: str


class SnippetGroupUpdate(BaseModel):
    name: str


class SnippetGroupRead(BaseModel):
    id: int
    name: str
    sort_order: int


class SnippetReorderItem(BaseModel):
    id: int
    group_name: str | None = None  # "" and None both mean ungrouped here
    sort_order: int


class SnippetReorderRequest(BaseModel):
    items: list[SnippetReorderItem]


class SnippetGroupReorderItem(BaseModel):
    id: int
    sort_order: int


class SnippetGroupReorderRequest(BaseModel):
    items: list[SnippetGroupReorderItem]


class SnippetBulkMoveRequest(BaseModel):
    ids: list[int]
    group_name: str = ""  # "" = ungroup


class SnippetBulkDeleteRequest(BaseModel):
    ids: list[int]


class SnippetImportResult(BaseModel):
    imported: int
    updated: int
    groups_created: int
    skipped: int
    errors: list[str] = []


# ---- Admin: user approval ----
class AdminUserRead(BaseModel):
    id: int
    email: str
    name: str
    picture: str
    approved: bool
    created_at: datetime
    last_login_at: datetime


class AdminUserUpdate(BaseModel):
    approved: bool
