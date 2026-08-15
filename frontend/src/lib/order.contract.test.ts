import { describe, expect, it } from 'vitest'
import contract from '../../../contracts/column-order.json'
import { columnComparator } from './order'
import type { Prompt, Status } from './types'

/**
 * The client half of the shared column-order contract.
 *
 * `contracts/column-order.json` is the single description of how one status
 * column is ordered; `backend/tests/test_ordering_contract.py` runs the very
 * same cases through `app/ordering.py:display_key`. Neither side owns the
 * file, so changing one implementation on its own goes red here instead of
 * quietly disagreeing with the other.
 *
 * The disagreement is not academic. A drag sends an ANCHOR ("put it before
 * #42"), never a position: the client picks that anchor from the order it
 * shows, the server inserts into the order it stores. While the two drifted,
 * a drag was saved and changed nothing on screen.
 */

interface OrderCase {
  name: string
  why: string
  prompts: {
    id: number
    sort_order: number
    status?: string
    blocked?: boolean
    tested?: boolean
    ran_at?: string
  }[]
  expected_ids: number[]
}

const cases = contract.cases as OrderCase[]

function prompt(spec: OrderCase['prompts'][number]): Prompt {
  return {
    id: spec.id,
    title: `p${spec.id}`,
    body: '',
    project_id: null,
    status: (spec.status ?? 'queued') as Status,
    sort_order: spec.sort_order,
    tags: '',
    bookmarked: false,
    bookmark_order: 0,
    tested: spec.tested ?? false,
    blocked: spec.blocked ?? false,
    optimized: false,
    optimized_body: null,
    optimized_at: null,
    optimization_model: '',
    optimization_version: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ran_at: spec.ran_at ?? null,
    attachments: [],
  }
}

describe('columnComparator against the shared contract', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const ordered = testCase.prompts.map(prompt).sort(columnComparator)
    expect(ordered.map((p) => p.id), testCase.why).toEqual(testCase.expected_ids)
  })

  it('gives the same answer whatever order the rows arrive in', () => {
    // The server returns a column in whatever order its query plan produces.
    // Two clients seeing different sequences for identical data would anchor
    // their drags against different neighbours.
    for (const testCase of cases) {
      const rows = testCase.prompts.map(prompt)
      const forwards = [...rows].sort(columnComparator).map((p) => p.id)
      const backwards = [...rows].reverse().sort(columnComparator).map((p) => p.id)
      expect(forwards, testCase.name).toEqual(testCase.expected_ids)
      expect(backwards, testCase.name).toEqual(testCase.expected_ids)
    }
  })

  it('is a consistent comparator, not just one that happens to sort', () => {
    // An inconsistent comparator (a < b AND b < a) makes the result depend on
    // the sort algorithm — the kind of bug that only shows up once a column
    // grows past the engine's insertion-sort threshold.
    for (const testCase of cases) {
      const rows = testCase.prompts.map(prompt)
      for (const a of rows) {
        for (const b of rows) {
          const ab = Math.sign(columnComparator(a, b))
          const ba = Math.sign(columnComparator(b, a))
          // Summed rather than negated: Math.sign(0) is 0 and -0, which are
          // distinct under Object.is, so comparing an element with itself
          // would fail a `toBe(-ba)` for no reason.
          expect(ab + ba, `${testCase.name}: ${a.id} vs ${b.id}`).toBe(0)
        }
      }
    }
  })

  it('carries enough cases to be worth trusting', () => {
    // Emptying the file would leave both suites green and proving nothing.
    expect(cases.length).toBeGreaterThanOrEqual(10)
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
    for (const testCase of cases) {
      expect(testCase.why.trim().length, testCase.name).toBeGreaterThan(0)
      expect(testCase.prompts.length, testCase.name).toBeGreaterThanOrEqual(2)
    }
  })
})
