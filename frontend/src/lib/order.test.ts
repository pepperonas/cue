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

  it('orders tested prompts by execution time, latest on top', () => {
    const list = [
      p(1, { tested: true, ran_at: '2026-07-10T08:00:00Z' }),
      p(2, { tested: true, ran_at: '2026-07-12T20:00:00Z' }),
      p(3, { tested: true, ran_at: '2026-07-11T12:00:00Z' }),
      p(4, { tested: false }),
    ].sort(columnComparator)
    expect(list.map((x) => x.id)).toEqual([4, 2, 3, 1])
  })

  it('tested prompts without ran_at fall back to drag order at the block end', () => {
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
