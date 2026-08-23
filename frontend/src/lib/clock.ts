/**
 * One ticking clock for every relative timestamp on the page.
 *
 * The board renders a few hundred ages at once. Giving each of them its own
 * `setInterval` is the obvious implementation and the wrong one: hundreds of
 * timers, hundreds of wake-ups, and every one of them re-rendering its
 * component whether or not the text it produces actually changed.
 *
 * Instead there is a single timer here. Subscribers are notified on each tick
 * and derive their own string; React's `useSyncExternalStore` then bails out
 * wherever that string is unchanged — which, after the first few minutes of a
 * prompt's life, is almost every card almost every time.
 *
 * Two properties matter for correctness:
 *
 *  * `now()` returns a value that changes ONLY on a tick. A live `Date.now()`
 *    would make `getSnapshot` return different results within one render pass
 *    at a threshold boundary, which React reports as an unstable store.
 *  * A hidden tab has its timers throttled to about once a minute (and a
 *    bfcache-restored page has them frozen entirely), so coming back has to
 *    resynchronise immediately rather than wait out the next interval — the
 *    same three events `useLiveSync` treats as "conditions changed".
 */

/** How often the labels are re-derived. */
export const TICK_MS = 10_000

export interface Clock {
  /** Epoch millis as of the last tick. */
  now(): number
  /** Register for ticks; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Re-read the time and notify — exposed for tests and wake-ups. */
  tick(): void
  /** Active subscriber count (tests). */
  size(): number
}

interface Options {
  intervalMs?: number
  /** Where the wake-up events are listened for; null disables them. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
  /** Whether the document is currently hidden (a wake-up while hidden is noise). */
  isVisible?: () => boolean
}

const WAKE_EVENTS = ['visibilitychange', 'pageshow', 'online'] as const

export function createClock(options: Options = {}): Clock {
  const {
    intervalMs = TICK_MS,
    target = typeof document === 'undefined' ? null : document,
    isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  } = options

  const listeners = new Set<() => void>()
  let current = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null

  function tick(): void {
    current = Date.now()
    for (const listener of listeners) listener()
  }

  function onWake(): void {
    // `visibilitychange` also fires when the tab goes AWAY; nothing to do then.
    if (isVisible()) tick()
  }

  function start(): void {
    if (timer !== null) return
    // The stored time is stale by however long nothing was subscribed.
    current = Date.now()
    timer = setInterval(tick, intervalMs)
    for (const name of WAKE_EVENTS) target?.addEventListener(name, onWake)
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
    for (const name of WAKE_EVENTS) target?.removeEventListener(name, onWake)
  }

  return {
    now: () => current,
    tick,
    size: () => listeners.size,
    subscribe(listener) {
      const first = listeners.size === 0
      listeners.add(listener)
      if (first) start()
      return () => {
        listeners.delete(listener)
        // No timestamps on screen (settings, statistics) means no timer at all.
        if (listeners.size === 0) stop()
      }
    },
  }
}

/** The clock the app uses. */
export const clock = createClock()
