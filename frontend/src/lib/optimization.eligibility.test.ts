import { describe, expect, it } from 'vitest'
import { isOptimizable } from './optimization'
import { STATUSES } from './types'

describe('isOptimizable', () => {
  it('allows exactly the queue', () => {
    expect(isOptimizable({ status: 'queued' })).toBe(true)
  })

  it('refuses every status a prompt reaches after it has been used', () => {
    // Optimizing rewrites the text you are ABOUT to send. Once a prompt is
    // running or done that text is history; failed and archived are out for
    // the same reason, and moving one back to the queue makes it eligible.
    for (const status of ['running', 'done', 'failed', 'archived'] as const) {
      expect(isOptimizable({ status }), status).toBe(false)
    }
  })

  it('is checked against every status the app knows', () => {
    // Pinning the whole list means a status added later shows up here as a
    // failing test rather than silently inheriting "not optimizable".
    expect(STATUSES).toEqual(['queued', 'running', 'done', 'failed', 'archived'])
    expect(STATUSES.filter((s) => isOptimizable({ status: s }))).toEqual(['queued'])
  })
})
