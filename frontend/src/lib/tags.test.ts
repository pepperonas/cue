import { describe, expect, it } from 'vitest'
import { DEV_TAGS, dedupeTags, mergeSuggestionPool, normalizeTags, rankSuggestions, type TagSuggestion } from './tags'

describe('dedupeTags', () => {
  it('splits, trims and drops empty segments', () => {
    expect(dedupeTags(' bug ,  ui,, ,api ')).toEqual(['bug', 'ui', 'api'])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(dedupeTags('Bug, bug, BUG, ui')).toEqual(['Bug', 'ui'])
  })

  it('handles null/undefined/empty input', () => {
    expect(dedupeTags(null)).toEqual([])
    expect(dedupeTags(undefined)).toEqual([])
    expect(dedupeTags('')).toEqual([])
  })
})

describe('normalizeTags', () => {
  it('joins the deduped tags back into a canonical string', () => {
    expect(normalizeTags('a,A , b')).toBe('a, b')
    expect(normalizeTags(null)).toBe('')
  })
})

describe('DEV_TAGS', () => {
  it('is lowercase, single-token and free of duplicates (round-trips the field)', () => {
    for (const tag of DEV_TAGS) {
      expect(tag).toBe(tag.toLowerCase())
      expect(tag).not.toMatch(/[\s,]/)
    }
    expect(new Set(DEV_TAGS).size).toBe(DEV_TAGS.length)
  })
})

describe('DEV_TAGS curated list', () => {
  it('has no case-insensitive duplicates', async () => {
    const { DEV_TAGS } = await import('./tags')
    const lower = DEV_TAGS.map((t) => t.toLowerCase())
    expect(new Set(lower).size).toBe(DEV_TAGS.length)
  })
  it('contains only lowercase single-token tags (hyphens, no spaces)', async () => {
    const { DEV_TAGS } = await import('./tags')
    for (const t of DEV_TAGS) {
      expect(t).toBe(t.toLowerCase())
      expect(t).not.toMatch(/\s/)
      expect(t.length).toBeGreaterThan(0)
    }
  })
})

describe('DEV_TAGS spelling policy', () => {
  it('uses American spelling only (no -isation/colour/behaviour/licence …)', async () => {
    const { DEV_TAGS } = await import('./tags')
    const british = /isation|iser$|colour|behaviour|licence|analyse|defence|catalogue|centre|artefact/
    expect(DEV_TAGS.filter((t) => british.test(t))).toEqual([])
  })
})

describe('suggestion ranking', () => {
  const pool: TagSuggestion[] = [
    { name: 'react', usage: 12, source: 'user' },
    { name: 'react-query', usage: 3, source: 'user' },
    { name: 'preact', usage: 1, source: 'user' },
    { name: 'dark-mode', usage: 5, source: 'user' },
    { name: 'redux', usage: 0, source: 'catalog' },
  ]

  it('ranks exact match over prefix over word-start over substring', () => {
    const names = rankSuggestions(pool, 'react').map((t) => t.name)
    expect(names[0]).toBe('react')
    expect(names[1]).toBe('react-query')
    expect(names).toContain('preact') // substring match still offered, but last
    expect(names.indexOf('preact')).toBeGreaterThan(names.indexOf('react-query'))
  })

  it('treats a hyphen as a word boundary', () => {
    expect(rankSuggestions(pool, 'mode').map((t) => t.name)).toEqual(['dark-mode'])
  })

  it('falls back to usage, then recency, then alphabet', () => {
    const byUsage = rankSuggestions(pool, '').map((t) => t.name)
    expect(byUsage.slice(0, 3)).toEqual(['react', 'dark-mode', 'react-query'])

    const tie: TagSuggestion[] = [
      { name: 'b', usage: 2, source: 'user', lastUsed: 100 },
      { name: 'a', usage: 2, source: 'user', lastUsed: 500 },
      { name: 'c', usage: 2, source: 'user' },
    ]
    expect(rankSuggestions(tie, '').map((t) => t.name)).toEqual(['a', 'b', 'c'])
  })

  it('excludes tags the prompt already carries and honours the limit', () => {
    const excluded = rankSuggestions(pool, 'react', { exclude: new Set(['react']) })
    expect(excluded.map((t) => t.name)).not.toContain('react')
    expect(rankSuggestions(pool, '', { limit: 2 })).toHaveLength(2)
  })

  it('drops candidates that do not match at all', () => {
    expect(rankSuggestions(pool, 'zzz')).toEqual([])
  })

  it('escapes regex characters in the query', () => {
    expect(() => rankSuggestions(pool, 'c++')).not.toThrow()
    expect(rankSuggestions([{ name: 'c++', usage: 0, source: 'user' }], 'c++')[0].name).toBe('c++')
  })
})

describe('mergeSuggestionPool', () => {
  it('keeps saved entries and appends unused catalogue words', () => {
    const merged = mergeSuggestionPool(
      [{ name: 'React', usage: 4, source: 'user' }],
      ['react', 'vue'],
    )
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ name: 'React', usage: 4, source: 'user' })
    expect(merged[1]).toMatchObject({ name: 'vue', usage: 0, source: 'catalog' })
  })

  it('ignores empty and duplicate saved entries', () => {
    const merged = mergeSuggestionPool(
      [
        { name: 'a', usage: 1, source: 'user' },
        { name: 'A', usage: 9, source: 'user' },
        { name: '  ', usage: 0, source: 'user' },
      ],
      [],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].usage).toBe(1)
  })
})
