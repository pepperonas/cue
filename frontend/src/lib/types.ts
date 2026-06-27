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
  created_at: string
  updated_at: string
  ran_at: string | null
}

export interface Me {
  authenticated: boolean
  csrf_token: string | null
}
