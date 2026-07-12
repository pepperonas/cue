import { describe, expect, it } from 'vitest'
import { abbreviationTaken, groupSnippets, UNGROUPED_KEY } from './snippets'
import type { Snippet, SnippetGroup } from './types'

function snip(id: number, abbreviation: string, group: string | null, sort = 0): Snippet {
  return {
    id,
    abbreviation,
    title: '',
    body: 'b',
    group_name: group,
    sort_order: sort,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const groups: SnippetGroup[] = [
  { id: 2, name: 'Zwei', sort_order: 2 },
  { id: 1, name: 'Eins', sort_order: 1 },
  { id: 3, name: 'Leer', sort_order: 3 },
]

describe('groupSnippets', () => {
  it('orders sections by group sort_order, keeps EMPTY groups, ungrouped last', () => {
    const sections = groupSnippets([snip(1, 'a', 'Zwei'), snip(2, 'b', null)], groups)
    expect(sections.map((s) => s.name)).toEqual(['Eins', 'Zwei', 'Leer', 'Ohne Gruppe'])
    expect(sections[2].snippets).toEqual([]) // empty group survives
    expect(sections[3].snippets.map((s) => s.abbreviation)).toEqual(['b'])
  })

  it('sorts snippets inside a section by sort_order then id', () => {
    const sections = groupSnippets(
      [snip(5, 'later', 'Eins', 2), snip(9, 'tie-b', 'Eins', 1), snip(4, 'tie-a', 'Eins', 1)],
      groups,
    )
    expect(sections[0].snippets.map((s) => s.abbreviation)).toEqual(['tie-a', 'tie-b', 'later'])
  })

  it('renders orphaned group names instead of losing snippets', () => {
    const sections = groupSnippets([snip(1, 'ghost', 'Verwaist')], groups)
    const orphan = sections.find((s) => s.name === 'Verwaist')
    expect(orphan?.snippets.map((s) => s.abbreviation)).toEqual(['ghost'])
    expect(orphan?.groupId).toBeNull()
  })

  it('handles the empty state (no snippets, no groups)', () => {
    const sections = groupSnippets([], [])
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe(UNGROUPED_KEY)
  })
})

describe('abbreviationTaken', () => {
  const list = [snip(1, 'aiplan', null), snip(2, 'Größe', null)]
  it('is case-insensitive and trims', () => {
    expect(abbreviationTaken(list, ' AIPLAN ')).toBe(true)
    expect(abbreviationTaken(list, 'größe')).toBe(true)
    expect(abbreviationTaken(list, 'new')).toBe(false)
  })
  it('excludes the edited snippet itself and ignores empty input', () => {
    expect(abbreviationTaken(list, 'aiplan', 1)).toBe(false)
    expect(abbreviationTaken(list, '   ')).toBe(false)
  })
})
