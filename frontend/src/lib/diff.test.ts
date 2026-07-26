import { describe, expect, it } from 'vitest'
import { buildDiff, collapseUnchanged, isGap, wordSegments, type DiffRow } from './diff'

describe('buildDiff', () => {
  it('marks untouched text as unchanged and numbers both sides', () => {
    const { rows, stats } = buildDiff('a\nb\nc', 'a\nb\nc')
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.kind === 'unchanged')).toBe(true)
    expect(rows[2]).toMatchObject({ left: 3, right: 3, text: 'c' })
    expect(stats).toEqual({ added: 0, removed: 0, unchanged: 3 })
  })

  it('reports pure insertions with no left-hand line number', () => {
    const { rows, stats } = buildDiff('a', 'a\nneu')
    expect(stats.added).toBe(1)
    const added = rows.find((r) => r.kind === 'added')!
    expect(added).toMatchObject({ text: 'neu', left: null, right: 2 })
  })

  it('reports deletions with no right-hand line number', () => {
    const { rows, stats } = buildDiff('a\nweg', 'a')
    expect(stats.removed).toBe(1)
    expect(rows.find((r) => r.kind === 'removed')).toMatchObject({ text: 'weg', right: null })
  })

  it('pairs a rewritten line into removed+added with word segments', () => {
    const { rows } = buildDiff('mach mir ne liste', 'Erstelle mir eine Liste')
    const removed = rows.find((r) => r.kind === 'removed')!
    const added = rows.find((r) => r.kind === 'added')!
    expect(removed.segments).toBeDefined()
    expect(added.segments).toBeDefined()
    // The unchanged word survives in both, the changed words only on their side.
    expect(removed.segments!.map((s) => s.value).join('')).toBe('mach mir ne liste')
    expect(added.segments!.map((s) => s.value).join('')).toBe('Erstelle mir eine Liste')
    expect(removed.segments!.some((s) => s.kind === 'removed')).toBe(true)
    expect(added.segments!.some((s) => s.kind === 'added')).toBe(true)
  })

  it('ignores a trailing newline instead of inventing an empty line', () => {
    expect(buildDiff('a\n', 'a\n').rows).toHaveLength(1)
  })

  it('handles empty input on either side', () => {
    expect(buildDiff('', '').rows).toEqual([])
    expect(buildDiff('', 'neu').stats.added).toBe(1)
    expect(buildDiff('alt', '').stats.removed).toBe(1)
  })
})

describe('wordSegments', () => {
  it('keeps only the segments belonging to the rendered side', () => {
    const removed = wordSegments('alter text', 'neuer text', 'removed')
    expect(removed.every((s) => s.kind !== 'added')).toBe(true)
    const added = wordSegments('alter text', 'neuer text', 'added')
    expect(added.every((s) => s.kind !== 'removed')).toBe(true)
  })
})

describe('collapseUnchanged', () => {
  const rows = buildDiff(
    Array.from({ length: 30 }, (_, i) => `zeile ${i}`).join('\n'),
    [...Array.from({ length: 29 }, (_, i) => `zeile ${i}`), 'zeile 29 geändert'].join('\n'),
  ).rows

  it('replaces long untouched stretches with a gap marker', () => {
    const collapsed = collapseUnchanged(rows, 3)
    expect(collapsed.length).toBeLessThan(rows.length)
    const gaps = collapsed.filter(isGap)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].gap).toBeGreaterThan(20)
  })

  it('keeps context lines around every change', () => {
    const collapsed = collapseUnchanged(rows, 3).filter((e) => !isGap(e)) as DiffRow[]
    expect(collapsed.some((r) => r.kind !== 'unchanged')).toBe(true)
    expect(collapsed.length).toBeGreaterThanOrEqual(4)
  })

  it('returns the rows untouched when everything is close to a change', () => {
    const small = buildDiff('a\nb', 'a\nc').rows
    expect(collapseUnchanged(small, 3)).toEqual(small)
  })
})
