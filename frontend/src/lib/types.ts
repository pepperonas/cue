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
  created_at: string
  updated_at: string
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
  csrf_token: string | null
  user: User | null
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
