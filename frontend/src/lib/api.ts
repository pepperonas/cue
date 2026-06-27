// Typed fetch client. Sends the CSRF double-submit header on mutations by
// reading the readable `cue_csrf` cookie.
import type { Me, Project, Prompt, Status } from './types'

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

  // Projects
  listProjects: () => request<Project[]>('GET', '/projects'),
  createProject: (name: string, color: string) =>
    request<Project>('POST', '/projects', { name, color }),
  updateProject: (id: number, patch: { name?: string; color?: string }) =>
    request<Project>('PATCH', `/projects/${id}`, patch),
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
      unassign_project: boolean
    }>,
  ) => request<Prompt>('PATCH', `/prompts/${id}`, patch),
  deletePrompt: (id: number) => request<void>('DELETE', `/prompts/${id}`),
  reorder: (items: { id: number; status: Status; sort_order: number }[]) =>
    request<Prompt[]>('POST', '/prompts/reorder', { items }),
  reorderBookmarks: (items: { id: number; bookmark_order: number }[]) =>
    request<Prompt[]>('POST', '/prompts/bookmarks/reorder', { items }),
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
