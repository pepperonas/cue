export type Status = 'queued' | 'running' | 'done' | 'failed' | 'archived'

export const STATUSES: Status[] = ['queued', 'running', 'done', 'failed', 'archived']

export const BOARD_COLUMNS: Status[] = ['queued', 'running', 'done']
export const EXTRA_COLUMNS: Status[] = ['failed', 'archived']

export const STATUS_LABEL: Record<Status, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  archived: 'Archived',
}

export const STATUS_ICON: Record<Status, string> = {
  queued: 'pending',
  running: 'play_circle',
  done: 'check_circle',
  failed: 'error',
  archived: 'inventory_2',
}

// CSS class that tints the status icon a subtle, status-specific color.
export const STATUS_CLASS: Record<Status, string> = {
  queued: 'st-queued',
  running: 'st-running',
  done: 'st-done',
  failed: 'st-failed',
  archived: 'st-archived',
}

export interface Project {
  id: number
  name: string
  color: string
  sort_order: number
  created_at: string
  prompt_count: number
}

export interface Attachment {
  id: number
  url: string
  name: string
  content_type: string
  size: number
}

export const PRIORITIES = ['high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** German labels, in the order the dropdown offers them (urgent first). */
export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'Hoch',
  normal: 'Mittel',
  low: 'Gering',
}

/** Glyph per level. The middle one is a plain dash on purpose: "normal" is
 *  the default of almost every prompt, and an eye-catching icon for "nothing
 *  special" would shout on every card. */
export const PRIORITY_ICON: Record<Priority, string> = {
  high: 'keyboard_double_arrow_up',
  normal: 'remove',
  low: 'keyboard_double_arrow_down',
}

export interface Prompt {
  id: number
  title: string
  body: string
  project_id: number | null
  status: Status
  sort_order: number
  tags: string
  bookmarked: boolean
  bookmark_order: number
  tested: boolean
  /** Urgency. Sorts the QUEUE only; absent on pre-0.51 responses. */
  priority: Priority
  /** "Needs a thorough test" — a marker on done work, no ordering effect. */
  test_closely: boolean
  // AI optimization — `body` above always stays the untouched original.
  optimized: boolean
  optimized_body: string | null
  optimized_at: string | null
  optimization_model: string
  optimization_version: number
  /** Set once an optimization was accepted into `body`; null otherwise. */
  optimization_applied_at?: string | null
  blocked: boolean
  created_at: string
  updated_at: string
  /** Last content write — what the cards show. Absent on pre-0.41 responses. */
  edited_at?: string | null
  ran_at: string | null
  attachments: Attachment[]
}

export interface User {
  email: string
  name: string
  picture: string
}

export interface Me {
  authenticated: boolean
  approved: boolean
  is_admin: boolean
  csrf_token: string | null
  user: User | null
}

export interface AdminUser {
  id: number
  email: string
  name: string
  picture: string
  approved: boolean
  created_at: string
  last_login_at: string
}

// ---- Run engine ----
export type RunKind = 'single' | 'chain'
export type RunStatus = 'queued' | 'claiming' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface Run {
  id: string
  kind: RunKind
  project_path: string
  status: RunStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  claude_session_id: string | null
  model: string | null
  allowed_tools: string | null
  permission_mode: string | null
  bare: boolean
  skip_permissions: boolean
  max_turns: number | null
  stop_on_error: boolean
  runner_id: string | null
  last_heartbeat: string | null
  cancel_requested: boolean
  total_cost_usd: number | null
  error: string | null
  steps_done: number
  steps_total: number
}

export interface RunStep {
  id: number
  step_index: number
  prompt_id: number | null
  prompt_text: string
  status: RunStatus
  claude_session_id: string | null
  output: string | null
  exit_code: number | null
  cost_usd: number | null
  started_at: string | null
  finished_at: string | null
}

export interface RunLog {
  seq: number
  step_index: number
  ts: string
  event_type: string
  line: string
}

export interface RunDetail extends Run {
  steps: RunStep[]
  logs: RunLog[]
}

export interface RunConfig {
  allowed_bases: string[]
  permission_modes: string[]
  models: string[]
}

// ---- Prompt capture ----
export interface CaptureSession {
  id: number
  claude_session_id: string
  project_id: number | null
  project_name: string | null
  cwd: string
  started_at: string
  last_at: string
  prompt_count: number
  deliverable: boolean
}

export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed'

export interface Delivery {
  id: number
  status: DeliveryStatus
  error?: string | null
}

export interface CapturedPrompt {
  id: number
  seq: number
  text: string
  created_at: string
}

export interface CaptureSessionDetail extends CaptureSession {
  prompts: CapturedPrompt[]
}

export interface CaptureSettings {
  project_base: string
  has_token: boolean
  token?: string | null
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  claiming: 'Claiming',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
}

export const RUN_STATUS_ICON: Record<RunStatus, string> = {
  queued: 'schedule',
  claiming: 'pending',
  running: 'play_circle',
  succeeded: 'check_circle',
  failed: 'error',
  canceled: 'cancel',
}

export const RUN_ACTIVE: RunStatus[] = ['queued', 'claiming', 'running']

// ---- Snippets (Inspector-Rust roundtrip workbench) ----
export interface Snippet {
  id: number
  abbreviation: string
  title: string
  body: string
  group_name: string | null
  sort_order: number
  version: number
  created_at: string
  updated_at: string
}

export interface SnippetGroup {
  id: number
  name: string
  sort_order: number
  // In the Inspector-Rust sync scope (toggled in the group header).
  synced: boolean
}

export interface SyncSettings {
  has_token: boolean
  sync_ungrouped: boolean
  last_sync: string | null
  token?: string | null
}

export interface SnippetImportResult {
  imported: number
  updated: number
  groups_created: number
  skipped: number
  errors: string[]
}

// ---- Statistics dashboard ----
// Mirrors the payload of `GET /api/stats` (built in backend `app/stats.py`).
export type StatsRangeKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'year'
  | 'last_year'
  | 'all'
  | 'custom'

export type Granularity = 'hour' | 'day' | 'week' | 'month'

/** A metric with its previous-period baseline; `delta_pct` is null when there
 *  is no baseline to compare against (both periods empty). */
export interface Kpi {
  value: number
  previous?: number
  delta_pct?: number | null
}

export interface SeriesPoint {
  t: string
  label: string
  [metric: string]: string | number
}

export interface StatsRange {
  key: StatsRangeKey
  label: string
  from: string
  to: string
  previous_from: string
  previous_to: string
  granularity: Granularity
  timezone: string
  days: number
}

export interface PromptStats {
  created: Kpi
  updated: Kpi
  deleted: Kpi
  completed: Kpi
  per_day_avg: number
  per_active_day_avg: number
  total: number
  backlog: number
  blocked: number
  bookmarked: number
  tested: number
  tested_rate: number
  completion_rate: number
  status_distribution: { status: Status; count: number }[]
  series: SeriesPoint[]
  length: {
    avg: number
    median: number
    p90: number
    histogram: { label: string; count: number }[]
    longest: { id: number; title: string; chars: number } | null
    shortest: { id: number; title: string; chars: number } | null
  }
  lead_time_hours: { avg: number | null; median: number | null; count: number }
}

export interface ProjectSlice {
  id: number | null
  name: string
  color: string
  count: number
}

export interface ProjectStats {
  total: number
  new: Kpi
  active: number
  top_by_prompts: ProjectSlice[]
  top_by_activity: ProjectSlice[]
  treemap: { name: string; value: number; color: string }[]
  recent: { id: number | null; name: string; color: string; at: string; prompts: number }[]
}

export interface TagStats {
  total: number
  new: Kpi
  new_list: string[]
  top: { tag: string; count: number }[]
  top_in_range: { tag: string; count: number }[]
  cloud: { tag: string; count: number }[]
  growth: { t: string; label: string; total: number }[]
  pairs: { a: string; b: string; count: number }[]
  untagged: number
}

export interface ActivityStats {
  events: number
  active_days: number
  range_days: number
  streak_current: number
  streak_longest: number
  total_active_days: number
  captured: Kpi
  sessions: number
  prompts_per_session: number
  session_minutes_median: number
  series: SeriesPoint[]
  heatmap: { weekday: number; hour: number; count: number }[]
  by_weekday: { weekday: string; count: number }[]
  by_hour: { hour: number; label: string; count: number }[]
  calendar: { date: string; count: number }[]
  peak_hour: number | null
  peak_weekday: string | null
  busiest_day: { date: string; count: number } | null
}

export interface AiStats {
  runs: Kpi
  steps: number
  success_rate: number | null
  avg_duration_s: number | null
  cost_total: number
  cost_previous: number
  cost_delta_pct: number | null
  cost_per_run: number
  cost_series: { t: string; label: string; cost: number; runs: number }[]
  by_model: { model: string; count: number }[]
  by_status: { status: RunStatus; count: number }[]
  lifetime_cost: number
  lifetime_runs: number
}

/**
 * Prompt optimization: how much AI rewriting happened and what it cost.
 *
 * ⚠️ `cost_*` is the figure the provider REPORTED (the Claude CLI prints
 * `total_cost_usd`), not a price × tokens calculation of ours — see the money
 * block at the top of `backend/app/stats.py` for why the stored token columns
 * cannot carry one. `cost_unpriced` counts the attempts that came back with no
 * accounting at all; they are shown as such and never averaged in as zero.
 */
export interface OptimizationStats {
  currency: string
  attempts: Kpi
  prompts_optimized: number
  succeeded: number
  failed: number
  canceled: number
  success_rate: number | null
  accept_rate: number | null
  applied: number
  discarded: number
  pending: number
  cost_total: number
  cost_previous: number
  cost_delta_pct: number | null
  /** null when nothing succeeded in the window — never 0, which would read as free. */
  cost_per_prompt: number | null
  cost_per_attempt: number | null
  cost_unpriced: number
  top_prompts: { prompt_id: number; title: string; attempts: number; cost: number }[]
  by_model: {
    model: string
    attempts: number
    cost: number
    cost_avg: number | null
    tokens_avg: number
  }[]
  avg_duration_s: number | null
  output_tokens: number
  /** Median length factor original → accepted rewrite. */
  length_factor: number | null
  cost_series: { t: string; label: string; cost: number; attempts: number }[]
  lifetime_attempts: number
  lifetime_prompts: number
  lifetime_cost: number
  lifetime_repeated: number
}

/** One model a user can point their own API key at, with its list price. */
export interface ApiKeyModel {
  id: string
  label: string
  input_per_mtok: number
  output_per_mtok: number
}

/**
 * The caller's own Anthropic key — status only.
 *
 * ⚠️ The key itself is never in here. `preview` is a masked tail; the plaintext
 * travels in one direction only, into the server.
 */
export interface ApiKeyStatus {
  configured: boolean
  preview: string
  model: string
  models: ApiKeyModel[]
  /** When the price table was last checked — the costs are estimates. */
  pricing_state: string
}

export interface Stats {
  range: StatsRange
  prompts: PromptStats
  projects: ProjectStats
  tags: TagStats
  activity: ActivityStats
  ai: AiStats | null
  optimization: OptimizationStats | null
  library: { snippets: number; sessions_total: number; captured_total: number }
  generated_at: string
}

export interface StatsQuery {
  range: StatsRangeKey
  from?: string
  to?: string
}

// ---- Prompt optimization (AI) ----
export type OptimizationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export const OPTIMIZATION_ACTIVE: OptimizationStatus[] = ['queued', 'running']

/** One optimization attempt — a job while it runs, a history entry afterwards. */
export interface Optimization {
  id: number
  prompt_id: number
  batch_id: string | null
  version: number
  status: OptimizationStatus
  provider: string
  model: string
  meta_prompt_version: number
  /** Rewritten to be project-agnostic (bookmarks) rather than merely sharpened. */
  universal: boolean
  /** A finished optimization is a proposal until it is applied or discarded. */
  decision: 'pending' | 'applied' | 'discarded' | 'superseded'
  decided_at: string | null
  original_text: string
  previous_text: string | null
  optimized_text: string | null
  exit_code: number | null
  duration_ms: number | null
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/** Result of reviewing a proposal: the attempt plus the updated prompt. */
export interface OptimizationDecisionResult {
  optimization: Optimization
  prompt: Prompt
}

export interface OptimizationBatch {
  id: string
  provider: string
  total: number
  done: number
  failed: number
  pending: number
  canceled: boolean
  created_at: string
  finished_at: string | null
}

export interface OptimizationProvider {
  id: string
  label: string
  description: string
  executed_by: string
}

export interface OptimizationConfig {
  enabled: boolean
  default_provider: string
  providers: OptimizationProvider[]
  timeout_s: number
  max_chars: number
  meta_prompt_version: number
}

// ---- Central tag vocabulary ----
export type TagSource = 'user' | 'system'

export interface Tag {
  id: number
  name: string
  source: TagSource
  usage_count: number
  created_at: string
  last_used_at: string | null
}

export interface TagList {
  items: Tag[]
  total: number
}

export interface TagRenameResult {
  tag: Tag
  /** True when the new name already existed and both were merged. */
  merged: boolean
}

export interface TagDeleteResult {
  deleted: number
  prompts_updated: number
  replaced_with: number | null
}

export interface TagUsage {
  tag: Tag
  prompts: { id: number; title: string; status: Status; project_id: number | null }[]
}

export type TagSort = 'usage' | 'name' | 'created' | 'recent'
