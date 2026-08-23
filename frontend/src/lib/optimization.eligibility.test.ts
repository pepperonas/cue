import { describe, expect, it } from 'vitest'
import { isOptimizable, optimizeState } from './optimization'
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

describe('optimizeState', () => {
  const base = { optimized: false, optimization_applied_at: null as string | null }

  it('is "none" for a prompt nobody has optimized', () => {
    expect(optimizeState(base)).toBe('none')
  })

  it('is "applied" once a proposal was accepted into the body', () => {
    expect(optimizeState({ ...base, optimization_applied_at: '2026-08-23T10:00:00Z' })).toBe('applied')
  })

  it('is "pending" while a proposal waits for a decision', () => {
    expect(optimizeState({ ...base, optimized: true })).toBe('pending')
  })

  it('ranks pending ABOVE applied when both hold', () => {
    // A prompt optimized last week with a fresh proposal on top: the pending
    // state is the one that asks something of the user, and the green "done"
    // tint would hide that request.
    expect(optimizeState({ optimized: true, optimization_applied_at: '2026-08-01T10:00:00Z' }))
      .toBe('pending')
  })

  it('treats a missing field as "not applied" rather than throwing', () => {
    // A response the service worker cached before the field existed.
    expect(optimizeState({ optimized: false })).toBe('none')
    expect(optimizeState({ optimized: true })).toBe('pending')
  })

  it('never returns a value outside the three the UI styles', () => {
    const seen = new Set<string>()
    for (const optimized of [true, false])
      for (const applied of [null, '2026-08-23T10:00:00Z'])
        seen.add(optimizeState({ optimized, optimization_applied_at: applied }))
    expect([...seen].sort()).toEqual(['applied', 'none', 'pending'])
  })
})
