import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INVALIDATIONS,
  MAX_BACKOFF_MS,
  WAIT_SECONDS,
  backoffMs,
  createChangeLoop,
  keysToInvalidate,
  shouldPoll,
} from './live-sync'
import type { ChangeFeed, ChangedEntity } from './live-sync'

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

describe('the shared vocabulary with the server', () => {
  it('knows exactly the entities app/changes.py reports', () => {
    // These strings ARE the wire format. Renaming one on either side stops
    // those updates silently — nothing errors, the view just stops refreshing.
    // The mirror of this assertion lives in backend/tests/test_changes.py.
    expect(Object.keys(INVALIDATIONS).sort()).toEqual([
      'projects',
      'prompts',
      'sessions',
      'snippets',
      'tags',
    ])
  })
})

// --------------------------------------------------------------- the loop

/** A fetch stub whose answers the test hands out one at a time. */
function stubFetch() {
  const calls: { since: string | null; wait: number }[] = []
  let settle: ((feed: ChangeFeed) => void) | null = null
  let fail: ((err: Error) => void) | null = null
  let aborts = 0

  const fetchChanges = (since: string | null, wait: number, signal: AbortSignal) => {
    calls.push({ since, wait })
    return new Promise<ChangeFeed>((resolve, reject) => {
      settle = resolve
      fail = reject
      signal.addEventListener('abort', () => {
        aborts += 1
        reject(new Error('aborted'))
      })
    })
  }

  return {
    fetchChanges,
    calls,
    get aborts() {
      return aborts
    },
    /** Answer the request currently in flight. */
    answer: async (feed: ChangeFeed) => {
      settle?.(feed)
      settle = null
      await Promise.resolve()
      await Promise.resolve()
    },
    reject: async (message = 'offline') => {
      fail?.(new Error(message))
      fail = null
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

const feed = (cursor: string, changed: ChangedEntity[] = []): ChangeFeed => ({ cursor, changed })

describe('createChangeLoop', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const build = (over: Partial<Parameters<typeof createChangeLoop>[0]> = {}) => {
    const api = stubFetch()
    const invalidated: string[][] = []
    const loop = createChangeLoop({
      fetchChanges: api.fetchChanges,
      invalidate: (key) => invalidated.push(key),
      ...over,
    })
    return { api, invalidated, loop }
  }

  it('collects a starting point before it starts waiting', async () => {
    // The client has just loaded its lists. Asking with a cursor it does not
    // have would report EVERYTHING as changed and reload all of them again.
    const { api, invalidated, loop } = build()
    loop.start()

    expect(api.calls[0]).toEqual({ since: null, wait: 0 })
    await api.answer(feed('c1'))
    expect(invalidated).toEqual([])
  })

  it('then parks a request carrying the cursor it was given', async () => {
    const { api, loop } = build()
    loop.start()
    await api.answer(feed('c1'))

    expect(api.calls[1]).toEqual({ since: 'c1', wait: WAIT_SECONDS })
  })

  it('invalidates what changed and immediately asks again', async () => {
    const { api, invalidated, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.answer(feed('c2', ['prompts']))

    expect(invalidated).toEqual([['prompts'], ['stats']])
    expect(api.calls[2]).toEqual({ since: 'c2', wait: WAIT_SECONDS })
  })

  it('advances the cursor even when nothing changed', async () => {
    // The budget ran out; the answer repeats the cursor. Going back out with a
    // stale one would be harmless here but wrong in general.
    const { api, invalidated, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.answer(feed('c1', []))

    expect(invalidated).toEqual([])
    expect(loop.cursor()).toBe('c1')
  })

  it('keeps the cursor across a failure, so nothing in between is skipped', async () => {
    const { api, invalidated, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.reject()

    expect(loop.cursor()).toBe('c1')
    expect(invalidated).toEqual([])

    await vi.advanceTimersByTimeAsync(backoffMs(1))
    expect(api.calls[2]).toEqual({ since: 'c1', wait: WAIT_SECONDS })
  })

  it('backs off further on each consecutive failure', async () => {
    const { api, loop } = build()
    loop.start()
    await api.answer(feed('c1'))

    await api.reject()
    await vi.advanceTimersByTimeAsync(backoffMs(1) - 1)
    expect(api.calls).toHaveLength(2) // still waiting
    await vi.advanceTimersByTimeAsync(1)
    expect(api.calls).toHaveLength(3)

    await api.reject()
    await vi.advanceTimersByTimeAsync(backoffMs(1))
    expect(api.calls, 'second failure must wait longer than the first').toHaveLength(3)
    await vi.advanceTimersByTimeAsync(backoffMs(2) - backoffMs(1))
    expect(api.calls).toHaveLength(4)
  })

  it('resets the backoff after a success', async () => {
    const { api, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.reject()
    await vi.advanceTimersByTimeAsync(backoffMs(1))
    await api.answer(feed('c2'))
    await api.reject()

    // Back to the first step, not the second.
    await vi.advanceTimersByTimeAsync(backoffMs(1))
    expect(api.calls).toHaveLength(5)
  })

  it('stops asking while the tab is hidden, and drops the parked request', async () => {
    let hidden = false
    const { api, loop } = build({ isHidden: () => hidden })
    loop.start()
    await api.answer(feed('c1'))
    expect(api.calls).toHaveLength(2)

    hidden = true
    loop.wake()
    await Promise.resolve()

    expect(api.aborts).toBe(1)
    expect(loop.running()).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.calls, 'kept polling while hidden').toHaveLength(2)
  })

  it('stops at the top of the loop when the tab went away unnoticed', async () => {
    // The visibilitychange listener is not the only thing that has to hold:
    // if a parked request answers normally while the tab is hidden, the loop
    // must not simply go back out for another one.
    let hidden = false
    const { api, loop } = build({ isHidden: () => hidden })
    loop.start()
    await api.answer(feed('c1'))
    expect(api.calls).toHaveLength(2)

    hidden = true
    await api.answer(feed('c2', ['prompts']))

    expect(api.calls, 'asked again while hidden').toHaveLength(2)
    expect(loop.running()).toBe(false)
  })

  it('catches up with one request when the tab comes back', async () => {
    let hidden = true
    const { api, loop } = build({ isHidden: () => hidden })
    loop.start()
    expect(api.calls, 'started while hidden').toHaveLength(0)

    hidden = false
    loop.wake()
    expect(api.calls).toHaveLength(1)
  })

  it('resumes from the cursor it had before it was hidden', async () => {
    let hidden = false
    const { api, loop } = build({ isHidden: () => hidden })
    loop.start()
    await api.answer(feed('c1'))

    hidden = true
    loop.wake()
    await Promise.resolve()
    hidden = false
    loop.wake()

    expect(api.calls[api.calls.length - 1]).toEqual({ since: 'c1', wait: WAIT_SECONDS })
  })

  it('cuts a backoff short when the network comes back', async () => {
    // Otherwise reconnecting can take another half minute for no reason.
    const { api, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.reject()
    await vi.advanceTimersByTimeAsync(3) // deep inside the backoff

    loop.wake()
    await Promise.resolve()
    await Promise.resolve()

    expect(api.calls).toHaveLength(3)
  })

  it('never runs two loops at once, however often it is woken', async () => {
    // visibilitychange, online and pageshow can all fire around the same
    // moment; a second loop would double every request from then on.
    const { api, loop } = build()
    loop.start()
    loop.start()
    loop.wake()
    loop.wake()

    expect(api.calls).toHaveLength(1)
    await api.answer(feed('c1'))
    expect(api.calls).toHaveLength(2)
  })

  it('stops for good on stop(), including a pending backoff', async () => {
    const { api, invalidated, loop } = build()
    loop.start()
    await api.answer(feed('c1'))
    await api.reject()

    loop.stop()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(api.calls).toHaveLength(2)
    expect(invalidated).toEqual([])
  })

  it('drops the parked request on stop() instead of leaking it', async () => {
    // Without the abort the server holds that request for the rest of its
    // budget, once per unmount — invisible locally, real on the server.
    const { api, loop } = build()
    loop.start()
    await api.answer(feed('c1'))

    loop.stop()
    expect(api.aborts).toBe(1)
  })

  it('ignores an answer that was already in flight when stop() came', async () => {
    // A resolved promise cannot be un-resolved by an abort, so the answer's
    // continuation still runs — after the component that owns the cache is
    // gone. Modelled with a request that does NOT reject on abort, because
    // that is the only way to reach the race.
    const calls: number[] = []
    const invalidated: string[][] = []
    // Collected in an array rather than a `let`: the assignment happens inside
    // the promise executor, so TypeScript's flow analysis would narrow a
    // variable back to `null` at the call site below.
    const answer: ((f: ChangeFeed) => void)[] = []
    const loop = createChangeLoop({
      fetchChanges: (_since, wait) => {
        calls.push(wait)
        return new Promise<ChangeFeed>((resolve) => answer.push(resolve))
      },
      invalidate: (key) => invalidated.push(key),
    })

    loop.start()
    answer[0]({ cursor: 'c2', changed: ['prompts'] }) // answer lands...
    loop.stop() // ...and the loop is torn down before it is processed
    await Promise.resolve()
    await Promise.resolve()

    expect(invalidated).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('survives an answer without a changed list', async () => {
    // Defensive: an older or partial payload must not take the loop down.
    const { api, invalidated, loop } = build()
    loop.start()
    await api.answer({ cursor: 'c1' } as ChangeFeed)
    await api.answer({ cursor: 'c2' } as ChangeFeed)

    expect(invalidated).toEqual([])
    expect(api.calls).toHaveLength(3)
  })
})
