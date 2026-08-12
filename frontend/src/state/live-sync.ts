import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { WAIT_SECONDS, backoffMs, keysToInvalidate, shouldPoll } from '../lib/live-sync'
import type { ChangedEntity } from '../lib/live-sync'

/**
 * Keep this browser in step with every other one signed into the same account.
 *
 * One request is parked on the server at a time (`GET /api/changes`, see
 * `app/changes.py`). It answers within about a second of anything changing —
 * on the phone, on the desktop, or from the CLI capture hook — and the only
 * thing this hook does with the answer is invalidate the affected queries and
 * ask again. React Query does the rest, so a prompt added on the phone appears
 * on the desktop without anyone reaching for reload.
 *
 * Two things it deliberately does NOT do:
 *
 * * **Suppress the echo of your own writes.** A local mutation moves the
 *   fingerprint too, so the poll comes back and invalidates what you just
 *   changed — one extra GET per mutation. Recognising your own writes would
 *   mean tagging every request with a client id and threading it through every
 *   write path; the refetch is cheap and self-correcting, that would not be.
 * * **Run while the tab is hidden.** See `shouldPoll`: a phone in a pocket
 *   would hold a socket open for an hour for updates nobody is looking at, and
 *   mobile browsers drop those connections anyway. It catches up in a single
 *   request when the tab comes back, because the server checks once before it
 *   starts waiting.
 */
export function useLiveSync(authenticated: boolean): void {
  const qc = useQueryClient()
  const cursor = useRef<string | null>(null)

  useEffect(() => {
    if (!authenticated) return
    let stopped = false
    let running = false
    let inFlight: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0

    // A backoff that can be cut short: coming back online is exactly the
    // moment to retry, and waiting out the remaining half minute would make
    // reconnecting feel broken.
    let wake: (() => void) | null = null
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          if (timer) clearTimeout(timer)
          timer = null
          wake = null
          resolve()
        }
        wake = done
        timer = setTimeout(done, ms)
      })

    async function loop() {
      if (running) return
      running = true
      try {
        while (!stopped && !document.hidden) {
          const controller = new AbortController()
          inFlight = controller
          try {
            // The first pass asks without a cursor: it only picks up the
            // starting point, so a client that has just loaded its lists does
            // not immediately load them again.
            const wait = cursor.current ? WAIT_SECONDS : 0
            const feed = await api.changes(cursor.current, wait, controller.signal)
            if (stopped) return
            cursor.current = feed.cursor
            failures = 0
            for (const key of keysToInvalidate(feed.changed as ChangedEntity[])) {
              void qc.invalidateQueries({ queryKey: key })
            }
          } catch {
            if (stopped || controller.signal.aborted) return
            // A dropped connection, a redeploy, a closed lid: back off, keep
            // the cursor, and resume exactly where we left off.
            failures += 1
            await sleep(backoffMs(failures))
          } finally {
            inFlight = null
          }
        }
      } finally {
        running = false
      }
    }

    function onWake() {
      if (stopped) return
      if (!shouldPoll({ authenticated, hidden: document.hidden })) {
        // Leaving: drop the parked request instead of making the server hold
        // it open for a tab nobody is looking at.
        inFlight?.abort()
        return
      }
      wake?.() // cut a backoff short
      void loop()
    }

    void loop()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      inFlight?.abort()
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [authenticated, qc])
}
