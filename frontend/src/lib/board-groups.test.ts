import { describe, expect, it } from 'vitest'
import {
  AUTO_COLLAPSE_FROM,
  COLUMN_CAP,
  NO_PROJECT,
  capToggleLabel,
  columnKey,
  countOpenByProject,
  defaultGroupsOpen,
  groupByProject,
  isOpen,
  visibleCards,
} from './board-groups'
import type { Project, Prompt } from './types'

function prompt(id: number, projectId: number | null): Prompt {
  return {
    id,
    title: `p${id}`,
    body: 'b',
    project_id: projectId,
    status: 'queued',
    sort_order: id,
    tags: '',
    bookmarked: false,
    bookmark_order: 0,
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
  }
}

const projects = new Map<number, Project>([
  [1, { id: 1, name: 'cue', color: '#6750A4', sort_order: 1, created_at: '' } as Project],
  [2, { id: 2, name: 'zauberkoch', color: '#9A3B3B', sort_order: 2, created_at: '' } as Project],
])

function build(ids: number[], mapping: Record<number, number | null>) {
  const byId = new Map(ids.map((id) => [id, prompt(id, mapping[id] ?? null)]))
  return groupByProject(ids, byId, projects, 'queued')
}

describe('groupByProject', () => {
  it('keeps card order and names the group after its project', () => {
    const groups = build([5, 6, 7], { 5: 1, 6: 1, 7: 2 })
    expect(groups.map((g) => g.name)).toEqual(['cue', 'zauberkoch'])
    expect(groups[0].ids).toEqual([5, 6])
    expect(groups[0].color).toBe('#6750A4')
    expect(groups[0].id).toBe('queued:1')
  })

  it('orders groups by their first card, not by the project list', () => {
    const groups = build([9, 8], { 9: 2, 8: 1 })
    expect(groups.map((g) => g.key)).toEqual([2, 1])
  })

  it('collects prompts without a project into a trailing group', () => {
    const groups = build([1, 2, 3], { 1: null, 2: 1, 3: null })
    expect(groups.map((g) => g.key)).toEqual([1, NO_PROJECT])
    const rest = groups[groups.length - 1]
    expect(rest.name).toBe('Ohne Projekt')
    expect(rest.ids).toEqual([1, 3])
    expect(rest.id).toBe('queued:none')
  })

  it('falls back gracefully for a project that is no longer loaded', () => {
    const byId = new Map([[1, prompt(1, 99)]])
    const groups = groupByProject([1], byId, projects, 'done')
    expect(groups[0].name).toBe('Ohne Projekt')
    expect(groups[0].key).toBe(99)
  })

  it('ignores ids without a prompt and handles an empty column', () => {
    expect(groupByProject([42], new Map(), projects, 'queued')).toEqual([])
    expect(groupByProject([], new Map(), projects, 'queued')).toEqual([])
  })
})

describe('open-state defaults', () => {
  it('keeps short columns expanded and collapses long ones', () => {
    expect(defaultGroupsOpen(3)).toBe(true)
    expect(defaultGroupsOpen(AUTO_COLLAPSE_FROM - 1)).toBe(true)
    expect(defaultGroupsOpen(AUTO_COLLAPSE_FROM)).toBe(false)
    expect(defaultGroupsOpen(120)).toBe(false)
  })

  it('lets an explicit choice win over the default', () => {
    expect(isOpen({}, 'queued:1', true)).toBe(true)
    expect(isOpen({ 'queued:1': false }, 'queued:1', true)).toBe(false)
    expect(isOpen({ 'queued:1': true }, 'queued:1', false)).toBe(true)
    expect(isOpen({ other: false }, 'queued:1', false)).toBe(false)
  })
})

describe('visibleCards', () => {
  const many = Array.from({ length: 25 }, (_, i) => i + 1)

  it('renders nothing for a collapsed section but still reports the size', () => {
    expect(visibleCards(many, { open: false })).toEqual({ shown: [], hidden: 25 })
  })

  it('caps a long open section and reports the remainder', () => {
    const { shown, hidden } = visibleCards(many, { open: true })
    expect(shown).toHaveLength(COLUMN_CAP)
    expect(hidden).toBe(25 - COLUMN_CAP)
  })

  it('renders everything once this section is expanded', () => {
    expect(visibleCards(many, { open: true, expanded: true })).toEqual({ shown: many, hidden: 0 })
  })

  it('keeps the cap during a drag: the column itself is the drop target', () => {
    // Mounting every card of a long column made it ~30 000 px tall and put
    // hundreds of droppables under continuous measurement, which is what made
    // the hit testing drift onto the wrong column.
    expect(visibleCards(many, { open: true }).shown).toHaveLength(COLUMN_CAP)
  })

  it('leaves short sections alone', () => {
    expect(visibleCards([1, 2, 3])).toEqual({ shown: [1, 2, 3], hidden: 0 })
    expect(visibleCards([])).toEqual({ shown: [], hidden: 0 })
  })

  it('keeps expansion per section: one key must not uncap another', () => {
    const expanded: Record<string, boolean> = { 'done:1': true }
    expect(visibleCards(many, { expanded: expanded['done:1'] }).hidden).toBe(0)
    expect(visibleCards(many, { expanded: expanded['done:2'] }).hidden).toBe(15)
  })
})

describe('capToggleLabel', () => {
  it('offers to expand while cards are hidden', () => {
    expect(capToggleLabel(25, 15, false)).toBe('15 weitere anzeigen')
  })

  it('stays reversible: expanding turns the button into a collapse action', () => {
    expect(capToggleLabel(25, 0, true)).toBe('Weniger anzeigen')
  })

  it('renders no toggle when the section never hit the cap', () => {
    expect(capToggleLabel(5, 0, false)).toBeNull()
    expect(capToggleLabel(5, 0, true)).toBeNull()
  })
})

describe('columnKey', () => {
  it('namespaces a column apart from the project groups inside it', () => {
    expect(columnKey('done')).toBe('col:done')
    expect(columnKey('done')).not.toBe('done:1')
  })
})

describe('countOpenByProject', () => {
  const p = (
    id: number,
    projectId: number | null,
    status: Prompt['status'],
    blocked = false,
  ) => ({ ...prompt(id, projectId), status, blocked })

  it('counts only queued and running prompts', () => {
    const counts = countOpenByProject([
      p(1, 1, 'queued'),
      p(2, 1, 'running'),
      p(3, 1, 'done'),
      p(4, 1, 'failed'),
      p(5, 1, 'archived'),
    ])
    expect(counts.get(1)).toBe(2)
  })

  it('buckets prompts without a project separately', () => {
    const counts = countOpenByProject([p(1, null, 'queued'), p(2, null, 'running'), p(3, 2, 'queued')])
    expect(counts.get(NO_PROJECT)).toBe(2)
    expect(counts.get(2)).toBe(1)
  })

  it('omits projects without open prompts entirely (no zero entries)', () => {
    const counts = countOpenByProject([p(1, 1, 'done')])
    expect(counts.has(1)).toBe(false)
    expect(counts.size).toBe(0)
  })

  it('leaves blocked prompts out — they are parked, not waiting', () => {
    const counts = countOpenByProject([
      p(1, 1, 'queued'),
      p(2, 1, 'queued', true),
      p(3, 1, 'running'),
    ])
    expect(counts.get(1)).toBe(2)
  })

  it('omits a project whose only open prompts are blocked', () => {
    const counts = countOpenByProject([p(1, 4, 'queued', true), p(2, 4, 'queued', true)])
    expect(counts.has(4)).toBe(false)
  })

  it('handles an empty board', () => {
    expect(countOpenByProject([]).size).toBe(0)
  })
})
