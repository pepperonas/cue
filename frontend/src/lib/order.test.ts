import { describe, expect, it } from 'vitest'
import { columnComparator, nextPriority } from './order'
import type { Prompt, Status } from './types'

function p(id: number, over: Partial<Prompt> = {}): Prompt {
  return {
    id,
    title: `p${id}`,
    body: 'b',
    project_id: null,
    status: 'done' as Status,
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
    ...over,
  }
}

describe('columnComparator', () => {
  it('sinks tested done prompts below untested ones', () => {
    const list = [
      p(1, { tested: true, ran_at: '2026-07-12T10:00:00Z' }),
      p(2, { tested: false }),
      p(3, { tested: false }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([2, 3, 1])
  })

  it('lets the drag order decide inside the tested block', () => {
    // Ordering the tested block by execution time made dragging those cards
    // pointless: the move was saved and the next render undid it, which read
    // as "reordering is not saved".
    const list = [
      p(1, { tested: true, sort_order: 3, ran_at: '2026-07-10T08:00:00Z' }),
      p(2, { tested: true, sort_order: 1, ran_at: '2026-07-12T20:00:00Z' }),
      p(3, { tested: true, sort_order: 2, ran_at: '2026-07-11T12:00:00Z' }),
      p(4, { tested: false, sort_order: 9 }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([4, 2, 3, 1])
  })

  it('ignores ran_at entirely — only the drag order counts', () => {
    const list = [
      p(9, { tested: true, ran_at: null, sort_order: 9 }),
      p(2, { tested: true, ran_at: '2026-07-12T10:00:00Z', sort_order: 2 }),
      p(5, { tested: true, ran_at: null, sort_order: 5 }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([2, 5, 9])
  })

  it('blocked always sinks below everything, even tested', () => {
    const list = [
      p(1, { blocked: true, tested: false }),
      p(2, { tested: true, ran_at: '2026-07-12T10:00:00Z' }),
      p(3, { tested: false }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('does not apply tested-sinking outside the done column', () => {
    const list = [
      p(1, { status: 'running' as Status, tested: true, sort_order: 1 }),
      p(2, { status: 'running' as Status, tested: false, sort_order: 2 }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([1, 2]) // pure drag order
  })
})

// These five cases mirror `backend/tests/test_move.py` ("displayed order").
// The comparator and the backend's `display_key` must agree: the client
// anchors a move on what the user SEES, the server inserts into what it
// STORES. While the two disagreed, drags were saved and had no visible effect.
describe('mirror of the backend display_key', () => {
  it('sinks blocked prompts to the bottom', () => {
    const list = [p(1, { blocked: true, sort_order: 1 }), p(2, { sort_order: 9 })]
    expect(list.sort(columnComparator).map((x) => x.id)).toEqual([2, 1])
  })

  it('sinks tested below untested in DONE only', () => {
    const done = [
      p(1, { status: 'done', tested: true, sort_order: 1 }),
      p(2, { status: 'done', tested: false, sort_order: 9 }),
    ]
    expect(done.sort(columnComparator).map((x) => x.id)).toEqual([2, 1])

    const queued = [
      p(1, { status: 'queued', tested: true, sort_order: 9 }),
      p(2, { status: 'queued', tested: false, sort_order: 1 }),
    ]
    expect(queued.sort(columnComparator).map((x) => x.id)).toEqual([2, 1])
  })

  it('otherwise follows the drag order', () => {
    const list = [p(1, { sort_order: 3 }), p(2, { sort_order: 1 }), p(3, { sort_order: 2 })]
    expect(list.sort(columnComparator).map((x) => x.sort_order)).toEqual([1, 2, 3])
  })

  it('breaks ties by id so the order is total', () => {
    const list = [p(7, { sort_order: 1 }), p(3, { sort_order: 1 })]
    expect(list.sort(columnComparator).map((x) => x.id)).toEqual([3, 7])
  })

  it('ignores ran_at entirely', () => {
    const list = [
      p(2, { status: 'done', tested: true, sort_order: 2, ran_at: '2026-07-20T10:00:00Z' }),
      p(1, { status: 'done', tested: true, sort_order: 1, ran_at: '2026-07-01T10:00:00Z' }),
    ]
    expect(list.sort(columnComparator).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('priority bands the queue', () => {
  const q = (id: number, priority: 'high' | 'normal' | 'low', sort_order: number) =>
    p(id, { status: 'queued', priority, sort_order })

  it('puts urgent work first, whatever was dragged where', () => {
    const rows = [q(1, 'low', 1), q(2, 'normal', 2), q(3, 'high', 3)]
    expect([...rows].sort(columnComparator).map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('leaves the drag order in charge inside a band', () => {
    const rows = [q(1, 'high', 9), q(2, 'high', 4)]
    expect([...rows].sort(columnComparator).map((x) => x.id)).toEqual([2, 1])
  })

  it('ignores priority outside the queue', () => {
    // Urgency answers "what next"; a finished prompt must not reshuffle Done.
    const rows = [p(1, { status: 'done', priority: 'low', sort_order: 1 }),
                  p(2, { status: 'done', priority: 'high', sort_order: 2 })]
    expect([...rows].sort(columnComparator).map((x) => x.id)).toEqual([1, 2])
  })

  it('still sinks blocked prompts below an urgent one', () => {
    const rows = [q(1, 'high', 1), q(2, 'low', 9)]
    rows[0].blocked = true
    expect([...rows].sort(columnComparator).map((x) => x.id)).toEqual([2, 1])
  })
})

describe('nextPriority', () => {
  it('reaches every level and returns home', () => {
    // From the default one click makes a prompt urgent — the thing people
    // actually reach for. Three clicks are a full circle from anywhere, so
    // the cycle can never strand someone on a level they did not want.
    expect(nextPriority('normal')).toBe('high')
    expect(nextPriority('high')).toBe('low')
    expect(nextPriority('low')).toBe('normal')
    let level: ReturnType<typeof nextPriority> = 'normal'
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      level = nextPriority(level)
      seen.add(level)
    }
    expect(seen).toEqual(new Set(['high', 'low', 'normal']))
    expect(level).toBe('normal')
  })
})
