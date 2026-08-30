import { describe, expect, it } from 'vitest'
import { bookmarkedPrompts, filterPrompts } from './filter'
import type { Prompt } from './types'

function prompt(id: number, extra: Partial<Prompt> = {}): Prompt {
  return {
    id,
    title: `Titel ${id}`,
    body: 'Rumpf',
    project_id: null,
    status: 'queued',
    sort_order: id,
    tags: '',
    bookmarked: false,
    bookmark_order: 0,
    priority: 'normal',
    tested: false,
    blocked: false,
    optimized: false,
    optimized_body: null,
    optimized_at: null,
    optimization_model: '',
    optimization_version: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ran_at: null,
    attachments: [],
    ...extra,
  }
}

describe('filterPrompts', () => {
  const list = [
    prompt(1, { project_id: 7, title: 'Login reparieren' }),
    prompt(2, { project_id: 8, body: 'Etwas über Migrationen' }),
    prompt(3, { project_id: null, tags: 'feature, ui' }),
  ]

  it('keeps everything without a filter', () => {
    expect(filterPrompts(list)).toHaveLength(3)
    expect(filterPrompts(list, {})).toHaveLength(3)
  })

  it('filters by project, including the "no project" bucket', () => {
    expect(filterPrompts(list, { project: 7 }).map((p) => p.id)).toEqual([1])
    expect(filterPrompts(list, { project: 'none' }).map((p) => p.id)).toEqual([3])
    expect(filterPrompts(list, { project: 'all' })).toHaveLength(3)
  })

  it('searches title, body and tags case-insensitively', () => {
    expect(filterPrompts(list, { query: 'LOGIN' }).map((p) => p.id)).toEqual([1])
    expect(filterPrompts(list, { query: 'migration' }).map((p) => p.id)).toEqual([2])
    expect(filterPrompts(list, { query: 'feature' }).map((p) => p.id)).toEqual([3])
    expect(filterPrompts(list, { query: '   ' })).toHaveLength(3) // blank is no filter
  })

  it('hides prompts waiting out their undo window', () => {
    expect(filterPrompts(list, { pendingDelete: [2] }).map((p) => p.id)).toEqual([1, 3])
    expect(filterPrompts(list, { pendingDelete: [] })).toHaveLength(3)
  })

  it('combines the criteria', () => {
    const hits = filterPrompts(list, { project: 8, query: 'migration', pendingDelete: [3] })
    expect(hits.map((p) => p.id)).toEqual([2])
  })
})

describe('bookmarkedPrompts', () => {
  const list = [
    prompt(1, { project_id: 7, bookmarked: true }),
    prompt(2, { project_id: 8, bookmarked: true }),
    prompt(3, { project_id: 8, bookmarked: false }),
  ]

  it('returns every bookmark, whatever project it belongs to', () => {
    expect(bookmarkedPrompts(list).map((p) => p.id)).toEqual([1, 2])
  })

  it('ignores the board filters entirely — that is the point', () => {
    // Same list, but the caller must not be able to scope it down by project
    // or search: those controls do not exist on the bookmarks tab.
    expect(bookmarkedPrompts(list)).toHaveLength(2)
    expect(filterPrompts(list, { project: 7 }).filter((p) => p.bookmarked)).toHaveLength(1)
  })

  it('still honours a pending deletion', () => {
    expect(bookmarkedPrompts(list, [1]).map((p) => p.id)).toEqual([2])
  })

  it('handles an empty shelf', () => {
    expect(bookmarkedPrompts([])).toEqual([])
    expect(bookmarkedPrompts([prompt(9)])).toEqual([])
  })
})
