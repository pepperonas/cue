import { describe, expect, it } from 'vitest'
import { dedupeTags, DEV_TAGS, normalizeTags } from './tags'

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
