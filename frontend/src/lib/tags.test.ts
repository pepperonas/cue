import { describe, expect, it } from 'vitest'
import {
  DEV_TAGS,
  dedupeTags,
  inlineCompletion,
  mergeSuggestionPool,
  normalizeTags,
  rankSuggestions,
  relatedTags,
  type TagSuggestion,
} from './tags'

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

describe('rankSuggestions — context', () => {
  const pool: TagSuggestion[] = [
    { name: 'improvement', usage: 94, source: 'system' },
    { name: 'optimization', usage: 68, source: 'system' },
    { name: 'animation', usage: 23, source: 'system' },
    { name: 'security', usage: 1, source: 'system' },
    { name: 'section', usage: 0, source: 'catalog' },
    { name: 'enhancement', usage: 43, source: 'system' },
  ]

  it('leads with what the title implies when nothing is typed', () => {
    const ranked = rankSuggestions(pool, '', { context: { derived: new Set(['animation']) } })
    expect(ranked[0].name).toBe('animation')
    expect(ranked[0].reason).toBe('title')
  })

  it('never lets context outrank a better match for what was typed', () => {
    // Typing "sec" must find `security`, however loudly the title says animation.
    const ranked = rankSuggestions(pool, 'sec', { context: { derived: new Set(['animation']) } })
    expect(ranked[0].name).toBe('security')

    // The sharper case: both candidates match "an", so both survive the filter —
    // `animation` by prefix, `enhancement` only as a substring. Match quality
    // has to win even though the title points at the weaker match.
    const typed = rankSuggestions(pool, 'an', { context: { derived: new Set(['enhancement']) } })
    expect(typed[0].name).toBe('animation')
  })

  it('ranks a co-occurring tag above an equally-matching but unrelated one', () => {
    const ranked = rankSuggestions(pool, '', { context: { related: new Set(['animation']) } })
    expect(ranked[0].name).toBe('animation')
    expect(ranked[0].reason).toBe('related')
    // …and the title still beats mere co-occurrence.
    const both = rankSuggestions(pool, '', {
      context: { derived: new Set(['security']), related: new Set(['animation']) },
    })
    expect(both.map((t) => t.name).slice(0, 2)).toEqual(['security', 'animation'])
  })

  it('falls back to usage when there is no context at all', () => {
    expect(rankSuggestions(pool, '')[0].name).toBe('improvement')
    expect(rankSuggestions(pool, '')[0].reason).toBeUndefined()
  })
})

describe('relatedTags', () => {
  const prompts = [
    { tags: 'feature, enhancement' },
    { tags: 'feature, enhancement' },
    { tags: 'feature, improvement' },
    { tags: 'bugfix, animation' },
  ]

  it('finds what travels with the chosen tags, most frequent first', () => {
    expect([...relatedTags(prompts, ['feature'])]).toEqual(['enhancement', 'improvement'])
  })

  it('excludes the tags already chosen', () => {
    expect([...relatedTags(prompts, ['feature', 'enhancement'])]).toEqual(['improvement'])
  })

  it('is empty when nothing is chosen yet', () => {
    expect(relatedTags(prompts, []).size).toBe(0)
    expect(relatedTags(prompts, ['  ']).size).toBe(0)
  })

  it('matches case-insensitively and honours the limit', () => {
    expect([...relatedTags(prompts, ['FEATURE'], 1)]).toEqual(['enhancement'])
  })
})

describe('inlineCompletion', () => {
  it('returns the characters that finish the typed fragment', () => {
    expect(inlineCompletion('anim', 'animation')).toBe('ation')
  })

  it('stays silent when the case differs — ghost text must not lie', () => {
    // "Sec" + "urity" would render "Security" while → commits "security".
    expect(inlineCompletion('Sec', 'security')).toBeNull()
  })

  it('stays silent when the suggestion is not a continuation at all', () => {
    // A word-start match inside the tag ("dark-mode" for "mode") is a valid
    // suggestion but nothing can be appended to what was typed.
    expect(inlineCompletion('mode', 'dark-mode')).toBeNull()
  })

  it('stays silent when nothing would be added or nothing was typed', () => {
    expect(inlineCompletion('animation', 'animation')).toBeNull()
    expect(inlineCompletion('', 'animation')).toBeNull()
    expect(inlineCompletion('anim', undefined)).toBeNull()
    expect(inlineCompletion('anim', null)).toBeNull()
  })
})
