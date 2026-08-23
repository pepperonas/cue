import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClock, TICK_MS } from './clock'

/** A stand-in for `document` that records what the clock listened for. */
function fakeTarget() {
  const handlers: Record<string, Set<EventListener>> = {}
  return {
    handlers,
    addEventListener(name: string, fn: EventListener) {
      ;(handlers[name] ??= new Set()).add(fn)
    },
    removeEventListener(name: string, fn: EventListener) {
      handlers[name]?.delete(fn)
    },
    fire(name: string) {
      for (const fn of handlers[name] ?? []) fn(new Event(name))
    },
    listening: () => Object.values(handlers).filter((s) => s.size > 0).length,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('createClock', () => {
  it('holds the time still between ticks', () => {
    // React calls getSnapshot repeatedly within one render pass; a live
    // Date.now() would return different values at a threshold boundary and be
    // reported as an unstable store.
    const clock = createClock({ target: null })
    clock.subscribe(() => {})
    const first = clock.now()
    vi.advanceTimersByTime(TICK_MS - 1)
    expect(clock.now()).toBe(first)
    vi.advanceTimersByTime(1)
    expect(clock.now()).toBe(first + TICK_MS)
  })

  it('runs ONE timer no matter how many subscribers there are', () => {
    const clock = createClock({ target: null })
    const calls = [0, 0, 0]
    const stops = calls.map((_, i) => clock.subscribe(() => (calls[i] += 1)))
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(TICK_MS)
    expect(calls).toEqual([1, 1, 1])
    stops.forEach((stop) => stop())
    expect(clock.size()).toBe(0)
  })

  it('has no timer at all while nothing is on screen', () => {
    // Settings and the statistics dashboard show no ages; they should not pay
    // for a ticking clock.
    const clock = createClock({ target: null })
    expect(vi.getTimerCount()).toBe(0)
    const stop = clock.subscribe(() => {})
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts cleanly after the last subscriber left', () => {
    const clock = createClock({ target: null })
    clock.subscribe(() => {})()
    let ticks = 0
    clock.subscribe(() => (ticks += 1))
    vi.advanceTimersByTime(TICK_MS)
    expect(ticks).toBe(1)
  })

  it('picks up the time lost while nothing was subscribed', () => {
    const clock = createClock({ target: null })
    const stop = clock.subscribe(() => {})
    stop()
    vi.advanceTimersByTime(60 * 60 * 1000) // an hour on another tab
    clock.subscribe(() => {})
    expect(clock.now()).toBe(Date.now())
  })

  it('resynchronises the moment a hidden tab comes back', () => {
    // Browsers throttle a background tab's timers to about once a minute and
    // freeze them entirely for a bfcache-restored page, so returning to the
    // tab must not show ages that are minutes stale.
    const target = fakeTarget()
    const clock = createClock({ target, isVisible: () => true })
    let ticks = 0
    clock.subscribe(() => (ticks += 1))
    vi.setSystemTime(new Date('2026-08-23T13:00:00Z'))
    for (const event of ['visibilitychange', 'pageshow', 'online']) {
      const before = ticks
      target.fire(event)
      expect(ticks, event).toBe(before + 1)
    }
    expect(clock.now()).toBe(Date.parse('2026-08-23T13:00:00Z'))
  })

  it('ignores the visibility event that fires on the way OUT', () => {
    const target = fakeTarget()
    const clock = createClock({ target, isVisible: () => false })
    let ticks = 0
    clock.subscribe(() => (ticks += 1))
    target.fire('visibilitychange')
    expect(ticks).toBe(0)
  })

  it('detaches its listeners with the last subscriber', () => {
    const target = fakeTarget()
    const clock = createClock({ target })
    const stop = clock.subscribe(() => {})
    expect(target.listening()).toBe(3)
    stop()
    expect(target.listening()).toBe(0)
  })

  it('survives a subscriber unsubscribing from inside its own callback', () => {
    const clock = createClock({ target: null })
    let ticks = 0
    const stop = clock.subscribe(() => {
      ticks += 1
      stop()
    })
    clock.subscribe(() => {})
    expect(() => vi.advanceTimersByTime(TICK_MS)).not.toThrow()
    expect(ticks).toBe(1)
    vi.advanceTimersByTime(TICK_MS)
    expect(ticks).toBe(1)
  })
})
