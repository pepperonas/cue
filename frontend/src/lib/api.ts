// Typed fetch client. Sends the CSRF double-submit header on mutations by
// reading the readable `cue_csrf` cookie.
import type {
  AdminUser,
  Snippet,
  SnippetGroup,
  SnippetImportResult,
  Attachment,
  CaptureSession,
  CaptureSessionDetail,
  CaptureSettings,
  Delivery,
  Me,
  Project,
  Prompt,
  Run,
  RunConfig,
  RunDetail,
  RunKind,
  RunStatus,
  Status,
} from './types'

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cue_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const opts: RequestInit = { method, credentials: 'same-origin', headers }

  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = csrfToken()
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(`/api${path}`, opts)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || res.statusText
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Request failed')
  }
  return data as T
}

export const api = {
  // Auth — login is a full-page redirect to Google, handled server-side.
  me: () => request<Me>('GET', '/auth/me'),
  googleLoginUrl: '/api/auth/google/login',
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),

  // Admin: user approval (owner-only)
  adminListUsers: () => request<AdminUser[]>('GET', '/admin/users'),
  adminSetApproval: (id: number, approved: boolean) =>
    request<AdminUser>('PATCH', `/admin/users/${id}`, { approved }),

  // Projects
  listProjects: () => request<Project[]>('GET', '/projects'),
  createProject: (name: string, color: string) =>
    request<Project>('POST', '/projects', { name, color }),
  updateProject: (id: number, patch: { name?: string; color?: string }) =>
    request<Project>('PATCH', `/projects/${id}`, patch),
  reorderProjects: (items: { id: number; sort_order: number }[]) =>
    request<Project[]>('POST', '/projects/reorder', { items }),
  deleteProject: (id: number) => request<void>('DELETE', `/projects/${id}`),

  // Prompts
  listPrompts: (params?: { project_id?: number; status?: Status; q?: string }) => {
    const qs = new URLSearchParams()
    if (params?.project_id != null) qs.set('project_id', String(params.project_id))
    if (params?.status) qs.set('status', params.status)
    if (params?.q) qs.set('q', params.q)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return request<Prompt[]>('GET', `/prompts${suffix}`)
  },
  createPrompt: (input: {
    body: string
    title?: string
    project_id?: number | null
    status?: Status
    tags?: string
    attachment_ids?: number[]
  }) => request<Prompt>('POST', '/prompts', input),
  updatePrompt: (
    id: number,
    patch: Partial<{
      title: string
      body: string
      project_id: number | null
      status: Status
      tags: string
      bookmarked: boolean
      tested: boolean
      blocked: boolean
      attachment_ids: number[]
      unassign_project: boolean
    }>,
  ) => request<Prompt>('PATCH', `/prompts/${id}`, patch),
  deletePrompt: (id: number) => request<void>('DELETE', `/prompts/${id}`),
  // Copy a prompt (incl. screenshots) into another project; lands as queued.
  duplicatePrompt: (id: number, project_id: number | null) =>
    request<Prompt>('POST', `/prompts/${id}/duplicate`, { project_id }),
  duplicatePromptInPlace: (id: number) =>
    request<Prompt>('POST', `/prompts/${id}/duplicate`, { in_place: true }),
  reorder: (items: { id: number; status: Status; sort_order: number }[]) =>
    request<Prompt[]>('POST', '/prompts/reorder', { items }),
  reorderBookmarks: (items: { id: number; bookmark_order: number }[]) =>
    request<Prompt[]>('POST', '/prompts/bookmarks/reorder', { items }),
  uploadAttachment: async (file: File): Promise<Attachment> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken() },
      body: fd,
    })
    if (!res.ok) {
      const text = await res.text()
      let detail = 'Upload fehlgeschlagen'
      try {
        detail = JSON.parse(text).detail || detail
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, detail)
    }
    return res.json()
  },
  deleteAttachment: (id: number) => request<void>('DELETE', `/attachments/${id}`),

  // Run engine
  runConfig: () => request<RunConfig>('GET', '/runs/config'),
  listRuns: (status?: RunStatus) =>
    request<Run[]>('GET', `/runs${status ? `?status=${status}` : ''}`),
  getRun: (id: string, afterSeq = 0) =>
    request<RunDetail>('GET', `/runs/${id}?after_seq=${afterSeq}`),
  createRun: (input: {
    kind: RunKind
    prompt_ids: number[]
    project_path: string
    model?: string | null
    allowed_tools?: string | null
    permission_mode?: string | null
    bare?: boolean
    skip_permissions?: boolean
    stop_on_error?: boolean
  }) => request<Run>('POST', '/runs', input),
  cancelRun: (id: string) => request<Run>('POST', `/runs/${id}/cancel`),

  // Prompt capture history
  listSessions: () => request<CaptureSession[]>('GET', '/sessions'),
  getSession: (id: number) => request<CaptureSessionDetail>('GET', `/sessions/${id}`),
  promoteCaptured: (sessionId: number, cpId: number) =>
    request<Prompt>('POST', `/sessions/${sessionId}/prompts/${cpId}/promote`),
  deleteSession: (id: number) => request<void>('DELETE', `/sessions/${id}`),
  // Send a prompt into a live session's terminal (owner-only, via the runner).
  sendToSession: (sessionId: number, text: string, submit: boolean) =>
    request<Delivery>('POST', `/sessions/${sessionId}/send`, { text, submit }),
  getDelivery: (id: number) => request<Delivery>('GET', `/cli/${id}`),
  getCaptureSettings: () => request<CaptureSettings>('GET', '/capture/settings'),
  updateCaptureSettings: (patch: { project_base?: string; regenerate?: boolean }) =>
    request<CaptureSettings>('POST', '/capture/settings', patch),
  mergePrompts: (input: {
    source_ids: number[]
    title?: string
    body: string
    project_id?: number | null
    status?: Status
    tags?: string
    originals: 'delete' | 'archive' | 'keep'
  }) => request<Prompt>('POST', '/prompts/merge', input),

  // Import / export return raw URLs for download handling in the UI.
  exportJsonUrl: '/api/export',
  exportZipUrl: '/api/export/txt',
  importTxt: async (
    files: File[],
    split_delimiter: string,
    project_id: number | null,
  ): Promise<Prompt[]> => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    fd.append('split_delimiter', split_delimiter)
    if (project_id != null) fd.append('project_id', String(project_id))
    const res = await fetch('/api/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken() },
      body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, 'Import failed')
    return res.json()
  },
}

// ---- Snippets ----
export const snippetsApi = {
  list: () => request<Snippet[]>('GET', '/snippets'),
  create: (input: { abbreviation: string; title: string; body: string; group_name: string | null }) =>
    request<Snippet>('POST', '/snippets', input),
  update: (
    id: number,
    patch: Partial<{ abbreviation: string; title: string; body: string; group_name: string }>,
  ) => request<Snippet>('PATCH', `/snippets/${id}`, patch),
  remove: (id: number) => request<void>('DELETE', `/snippets/${id}`),
  reorder: (items: { id: number; group_name: string; sort_order: number }[]) =>
    request<Snippet[]>('POST', '/snippets/reorder', { items }),
  bulkMove: (ids: number[], group_name: string) =>
    request<Snippet[]>('POST', '/snippets/bulk-move', { ids, group_name }),
  bulkDelete: (ids: number[]) => request<void>('POST', '/snippets/bulk-delete', { ids }),
  groups: () => request<SnippetGroup[]>('GET', '/snippets/groups'),
  createGroup: (name: string) => request<SnippetGroup>('POST', '/snippets/groups', { name }),
  renameGroup: (id: number, name: string) =>
    request<SnippetGroup>('PATCH', `/snippets/groups/${id}`, { name }),
  deleteGroup: (id: number) => request<void>('DELETE', `/snippets/groups/${id}`),
  reorderGroups: (items: { id: number; sort_order: number }[]) =>
    request<SnippetGroup[]>('POST', '/snippets/groups/reorder', { items }),
  importBackup: async (file: File): Promise<SnippetImportResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/snippets/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken() },
      body: fd,
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new Error(data?.detail || 'Import fehlgeschlagen')
    return data as SnippetImportResult
  },
}
