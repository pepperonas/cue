import { describe, expect, it } from 'vitest'
import {
  INVALIDATIONS,
  MAX_BACKOFF_MS,
  WAIT_SECONDS,
  backoffMs,
  keysToInvalidate,
  shouldPoll,
} from './live-sync'
import type { ChangedEntity } from './live-sync'

describe('keysToInvalidate', () => {
  it('reaches past the list a change happened in', () => {
    // A tag rename rewrites the tag strings cached on the prompts without
    // touching their own timestamps — refreshing only the tag list would leave
    // the board showing the old spelling.
    expect(keysToInvalidate(['tags'])).toContainEqual(['prompts'])
    // The dashboard is aggregated from prompts, projects and tags.
    for (const entity of ['prompts', 'projects', 'tags'] as ChangedEntity[]) {
      expect(keysToInvalidate([entity])).toContainEqual(['stats'])
    }
    // Snippets and their groups are one view and always reload together.
    expect(keysToInvalidate(['snippets'])).toEqual([['snippets'], ['snippet-groups']])
  })

  it('invalidates each key once even when several entities share it', () => {
    const keys = keysToInvalidate(['prompts', 'tags', 'projects'])
    const ids = keys.map((k) => k.join('/'))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id === 'stats')).toHaveLength(1)
  })

  it('does nothing for an empty batch', () => {
    expect(keysToInvalidate([])).toEqual([])
  })

  it('ignores an entity the server knows and this build does not', () => {
    // Forward compatibility: a deployed backend may report something this
    // bundle has never heard of. That must not throw and take the loop down.
    expect(() => keysToInvalidate(['brandnew' as ChangedEntity])).not.toThrow()
    expect(keysToInvalidate(['brandnew' as ChangedEntity])).toEqual([])
  })

  it('covers every entity it declares', () => {
    for (const [entity, keys] of Object.entries(INVALIDATIONS)) {
      expect(keys.length, `${entity} invalidates nothing`).toBeGreaterThan(0)
    }
  })
})

describe('backoffMs', () => {
  it('goes straight back out after a success', () => {
    // The whole point of long polling: no artificial delay between requests.
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(-1)).toBe(0)
  })

  it('doubles per consecutive failure and stops at the ceiling', () => {
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(2)).toBe(2000)
    expect(backoffMs(3)).toBe(4000)
    expect(backoffMs(99)).toBe(MAX_BACKOFF_MS)
  })
})

describe('shouldPoll', () => {
  it('needs a session', () => {
    expect(shouldPoll({ authenticated: false, hidden: false })).toBe(false)
  })

  it('stops while the tab is hidden', () => {
    // A phone in a pocket would otherwise hold a socket open for an hour.
    expect(shouldPoll({ authenticated: true, hidden: true })).toBe(false)
    expect(shouldPoll({ authenticated: true, hidden: false })).toBe(true)
  })
})

describe('WAIT_SECONDS', () => {
  it('stays under the server ceiling', () => {
    // The backend clamps at 25 s, which itself sits under the reverse proxy's
    // 60 s read timeout. Asking for more would just be silently clamped.
    expect(WAIT_SECONDS).toBeLessThanOrEqual(25)
    expect(WAIT_SECONDS).toBeGreaterThan(5)
  })
})
