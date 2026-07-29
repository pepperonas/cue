import { describe, expect, it } from 'vitest'
import { columnComparator } from './order'
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
