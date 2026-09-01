"""Pydantic request/response schemas (separate from table models)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel

from .models import (
    OptimizationDecision,
    OptimizationStatus,
    PromptPriority,
    PromptStatus,
    RunKind,
    RunStatus,
    TagSource,
)


def _as_utc(value: datetime) -> datetime:
    """Make a timestamp explicitly UTC.

    SQLite hands rows back NAIVE while a freshly written row is still aware, so
    one and the same response used to carry both `...839915` and `...997876Z`.
    A JSON date-time without a zone designator is LOCAL time to every browser
    (ES2015+), so the naive half arrived shifted by the viewer's UTC offset —
    two hours in Berlin. That was invisible while nothing computed with the
    values; the relative timestamps on the cards would have reported everything
    younger than the offset as "gerade eben" forever.

    Normalizing on validation (not on serialization) means the value is aware
    everywhere the model is used, and Pydantic then emits the `Z` by itself.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Every timestamp that leaves the API goes through this. `tests/test_wire_time.py`
# sweeps the module and fails if a schema reintroduces a bare `datetime`.
Utc = Annotated[datetime, AfterValidator(_as_utc)]


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
    created_at: Utc
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
    # Set when the prompt is created from the bookmarks tab: it has to land on
    # that shelf, otherwise the user creates something and sees nothing.
    bookmarked: bool = False
    priority: PromptPriority = PromptPriority.normal


class PromptUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    project_id: int | None = None
    status: PromptStatus | None = None
    tags: str | None = None
    bookmarked: bool | None = None
    tested: bool | None = None
    blocked: bool | None = None
    priority: PromptPriority | None = None
    test_closely: bool | None = None
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
    priority: PromptPriority = PromptPriority.normal
    test_closely: bool = False
    created_at: Utc
    updated_at: Utc
    # Last content write; null only for rows a client of an older build wrote.
    edited_at: Utc | None = None
    ran_at: Utc | None
    # AI optimization state (the original `body` above is never overwritten).
    optimized: bool = False
    optimized_body: str | None = None
    optimized_at: Utc | None = None
    optimization_model: str = ""
    optimization_version: int = 0
    # Null until an optimization was accepted into `body` (see the model).
    optimization_applied_at: Utc | None = None
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


class MoveRequest(BaseModel):
    """Anchored move — the client names a neighbour, never a position.

    Positions computed in the browser are wrong as soon as a filter hides part
    of the column (see app/ordering.py); a neighbour id is unambiguous either
    way. `status` may move the prompt to another column; omitting it keeps the
    current one. Without an anchor the prompt goes to the top (`top=True`) or
    to the end of the column.
    """

    status: PromptStatus | None = None
    before_id: int | None = None
    after_id: int | None = None
    top: bool = False


class BulkMoveRequest(MoveRequest):
    """Anchored move of several prompts at once (a board multi-selection).

    `ids` travel in the order they should end up in — the client sends them in
    display order, and the block keeps that order at the target.
    """

    ids: list[int]


class BookmarkMoveRequest(BaseModel):
    """Anchored move inside the bookmarks section."""

    before_id: int | None = None
    after_id: int | None = None
    top: bool = False


class DuplicateRequest(BaseModel):
    # Target project for the copy (None = no project).
    project_id: int | None = None
    # True = full in-place duplicate: same project + status as the source,
    # title suffixed "(n+1)", placed directly below the original. project_id
    # is ignored in this mode.
    in_place: bool = False


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
    # NOTE: no `priority` here on purpose — the merged prompt always inherits
    # the HIGHEST of its sources, which is a rule, not a choice. The server
    # derives it; see routers/prompts.py:merge_prompts.


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
    started_at: Utc | None
    finished_at: Utc | None


class RunLogRead(BaseModel):
    seq: int
    step_index: int
    ts: Utc
    event_type: str
    line: str


class RunRead(BaseModel):
    id: str
    kind: RunKind
    project_path: str
    status: RunStatus
    created_at: Utc
    started_at: Utc | None
    finished_at: Utc | None
    claude_session_id: str | None
    model: str | None
    allowed_tools: str | None
    permission_mode: str | None
    bare: bool
    skip_permissions: bool
    max_turns: int | None
    stop_on_error: bool
    runner_id: str | None
    last_heartbeat: Utc | None
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
    created_at: Utc


class CaptureSessionRead(BaseModel):
    id: int
    claude_session_id: str
    project_id: int | None
    project_name: str | None = None
    cwd: str
    started_at: Utc
    last_at: Utc
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
    created_at: Utc
    updated_at: Utc


class SnippetGroupCreate(BaseModel):
    name: str


class SnippetGroupUpdate(BaseModel):
    name: str | None = None
    # Toggle whether this group is in the Inspector-Rust sync scope.
    synced: bool | None = None


class SnippetGroupRead(BaseModel):
    id: int
    name: str
    sort_order: int
    synced: bool


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


# ---- Snippet sync with Inspector Rust (IR polls /api/sync/snippets) ----
class SyncSnippetItem(BaseModel):
    abbreviation: str
    title: str = ""
    body: str = ""
    # Group NAME; "" = ungrouped (groups travel by name, like the IR backup).
    category: str = ""
    version: int = 1


class SyncTombstoneItem(BaseModel):
    abbreviation: str
    # Revision the snippet had when deleted (peer deletes only if not newer).
    version: int = 1
    deleted_at_ms: int = 0


class SyncPullResponse(BaseModel):
    # The sync scope, managed in cue: enabled group names + the ungrouped flag.
    groups: list[str]
    sync_ungrouped: bool
    snippets: list[SyncSnippetItem]
    tombstones: list[SyncTombstoneItem]


class SyncPushRequest(BaseModel):
    snippets: list[SyncSnippetItem] = []
    tombstones: list[SyncTombstoneItem] = []


class SyncPushResult(BaseModel):
    created: int
    updated: int
    unchanged: int
    kept_local: int  # local copy was newer (or won the tie) — nothing applied
    deleted: int  # removed via incoming tombstones
    ignored: int  # out of scope or tombstoned here


class SyncSettingsRead(BaseModel):
    has_token: bool
    sync_ungrouped: bool
    last_sync: Utc | None = None
    # Shown exactly once, right after regeneration.
    token: str | None = None


class SyncSettingsUpdate(BaseModel):
    regenerate: bool = False
    sync_ungrouped: bool | None = None


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
    created_at: Utc
    last_login_at: Utc


class AdminUserUpdate(BaseModel):
    approved: bool


# ---- Prompt optimization ----
class OptimizationCreate(BaseModel):
    prompt_id: int
    # Optimizer backend id; omitted = the configured default.
    provider: str | None = None


class OptimizationDecisionResult(BaseModel):
    """Outcome of reviewing a proposal — the attempt plus the updated prompt.

    The prompt travels along so the client can clear the pending state (and
    show the new body after an apply) without a second request.
    """

    optimization: OptimizationRead
    prompt: PromptRead


class ApiKeyModel(BaseModel):
    """One model the user can point their own key at, with its list price."""

    id: str
    label: str
    input_per_mtok: float
    output_per_mtok: float


class ApiKeyStatus(BaseModel):
    """What the settings page may know about a stored key.

    ⚠️ `preview` is a masked tail, never the key. The plaintext exists in one
    direction only: into the database, and from there into an API call.
    """

    configured: bool
    preview: str = ""
    model: str
    models: list[ApiKeyModel] = []
    #: When the price table was last checked — the costs shown are estimates.
    pricing_state: str = ""


class ApiKeyUpdate(BaseModel):
    #: None leaves the key untouched, "" removes it, anything else replaces it.
    key: str | None = None
    #: None leaves the model untouched, "" resets to the default.
    model: str | None = None


class OptimizationBatchCreate(BaseModel):
    project_id: int | None = None
    # False re-optimizes prompts that already have a version.
    only_pending: bool = True
    provider: str | None = None


class OptimizationRead(BaseModel):
    """History entry / job state. Texts travel along so the diff view needs no
    second request."""

    id: int
    prompt_id: int
    batch_id: str | None
    version: int
    status: OptimizationStatus
    provider: str
    model: str
    meta_prompt_version: int
    universal: bool
    decision: OptimizationDecision
    decided_at: Utc | None
    original_text: str
    previous_text: str | None
    optimized_text: str | None
    original_title: str
    original_tags: str
    optimized_title: str | None
    optimized_tags: str | None
    exit_code: int | None
    duration_ms: int | None
    cost_usd: float | None
    input_tokens: int | None
    output_tokens: int | None
    error: str | None
    created_at: Utc
    started_at: Utc | None
    finished_at: Utc | None


class OptimizationBatchRead(BaseModel):
    id: str
    provider: str
    total: int
    done: int
    failed: int
    pending: int
    canceled: bool
    created_at: Utc
    finished_at: Utc | None


class OptimizationProviderRead(BaseModel):
    id: str
    label: str
    description: str
    executed_by: str


class OptimizationConfigRead(BaseModel):
    enabled: bool
    default_provider: str
    providers: list[OptimizationProviderRead]
    timeout_s: int
    max_chars: int
    meta_prompt_version: int


# ---- Runner-facing (Bearer RUNNER_TOKEN) ----
class OptimizationClaimRequest(BaseModel):
    runner_id: str = "mac-runner"


class OptimizationClaimResponse(BaseModel):
    id: int
    provider: str
    model: str
    # Fully built meta prompt — the executor never assembles prompts itself.
    prompt: str
    timeout_s: int
    max_chars: int
    max_retries: int
    prompt_id: int
    version: int


class OptimizationResultRequest(BaseModel):
    status: OptimizationStatus
    optimized_text: str | None = None
    model: str = ""
    exit_code: int | None = None
    duration_ms: int | None = None
    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


# ---- Tags (central vocabulary) ----
class TagRead(BaseModel):
    id: int
    name: str
    source: TagSource
    usage_count: int
    created_at: Utc
    last_used_at: Utc | None = None


class TagListResponse(BaseModel):
    items: list[TagRead]
    total: int


class TagCreate(BaseModel):
    name: str
    source: TagSource = TagSource.user


class TagUpdate(BaseModel):
    name: str


class TagRenameResult(BaseModel):
    tag: TagRead
    # True when the new name already existed and both tags were merged.
    merged: bool


class TagDeleteResult(BaseModel):
    deleted: int  # tag ids removed (1)
    prompts_updated: int
    replaced_with: int | None = None


class PromptRef(BaseModel):
    id: int
    title: str
    status: PromptStatus
    project_id: int | None


class TagUsageRead(BaseModel):
    """Impact preview for the delete dialog."""

    tag: TagRead
    prompts: list[PromptRef]
