import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

type FetchCall = { url: string; init: RequestInit }

function mockFetch(status: number, body?: unknown) {
  const calls: FetchCall[] = []
  const text = body === undefined ? '' : JSON.stringify(body)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(status === 204 ? null : text, { status })
    }),
  )
  return calls
}

beforeEach(() => {
  document.cookie = 'cue_csrf=csrf-token-123'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request plumbing', () => {
  it('prefixes /api and parses the JSON response', async () => {
    const calls = mockFetch(200, [{ id: 1 }])
    const prompts = await api.listPrompts()
    expect(calls[0].url).toBe('/api/prompts')
    expect(prompts).toEqual([{ id: 1 }])
  })

  it('sends the CSRF double-submit header on mutations, not on GETs', async () => {
    const calls = mockFetch(201, { id: 1 })
    await api.createPrompt({ body: 'x' })
    const post = calls[0].init.headers as Record<string, string>
    expect(post['X-CSRF-Token']).toBe('csrf-token-123')
    expect(post['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ body: 'x' })

    await api.listProjects()
    const get = calls[1].init.headers as Record<string, string>
    expect(get['X-CSRF-Token']).toBeUndefined()
  })

  it('decodes the csrf cookie value', async () => {
    document.cookie = 'cue_csrf=a%2Fb%3Dc'
    const calls = mockFetch(200, { ok: true })
    await api.logout()
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('a/b=c')
  })

  it('builds prompt list query strings from the params', async () => {
    const calls = mockFetch(200, [])
    await api.listPrompts({ project_id: 7, status: 'done', q: 'parser fix' })
    expect(calls[0].url).toBe('/api/prompts?project_id=7&status=done&q=parser+fix')
  })

  it('throws a typed ApiError carrying the server detail', async () => {
    mockFetch(409, { detail: 'Project name already exists' })
    const err = await api.createProject('x', '#111111').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('Project name already exists')
  })

  it('resolves undefined for 204 No Content', async () => {
    mockFetch(204)
    await expect(api.deletePrompt(1)).resolves.toBeUndefined()
  })
})

describe('multipart endpoints', () => {
  it('uploads attachments as FormData with the CSRF header but no JSON content type', async () => {
    const calls = mockFetch(201, { id: 5, url: '/api/attachments/5' })
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const att = await api.uploadAttachment(file)
    expect(att.id).toBe(5)
    const { init } = calls[0]
    expect(init.body).toBeInstanceOf(FormData)
    const headers = init.headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('csrf-token-123')
    expect(headers['Content-Type']).toBeUndefined() // browser sets the boundary
  })

  it('surfaces the upload error detail', async () => {
    mockFetch(413, { detail: 'File too large' })
    const file = new File(['x'], 'big.png', { type: 'image/png' })
    const err = await api.uploadAttachment(file).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(413)
    expect(err.message).toBe('File too large')
  })

  it('imports txt files with delimiter and optional project id', async () => {
    const calls = mockFetch(200, [])
    await api.importTxt([new File(['a'], 'a.txt')], 'rule', 3)
    const fd = calls[0].init.body as FormData
    expect(calls[0].url).toBe('/api/import')
    expect(fd.get('split_delimiter')).toBe('rule')
    expect(fd.get('project_id')).toBe('3')
  })
})
