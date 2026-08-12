import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { createChangeLoop } from '../lib/live-sync'

/**
 * Keep this browser in step with every other one signed into the same account.
 *
 * One request is parked on the server at a time (`GET /api/changes`, see
 * `app/changes.py`). It answers within about a second of anything changing —
 * on the phone, on the desktop, or from the CLI capture hook — and all this
 * does with the answer is invalidate the affected queries and ask again. React
 * Query does the rest, so a prompt added on the phone appears on the desktop
 * without anyone reaching for reload.
 *
 * Deliberately glue only: the loop's rules live in `lib/live-sync.ts`
 * (`createChangeLoop`) where they can be tested without a renderer. What is
 * left here is the wiring to React Query and to the three browser events that
 * mean "conditions changed":
 *
 *   visibilitychange — the tab went away (drop the parked request) or came
 *                      back (catch up in one request, since the server checks
 *                      once before it starts waiting)
 *   online           — the network returned; cut any backoff short
 *   pageshow         — restored from the back/forward cache
 *
 * One thing it does NOT do: suppress the echo of your own writes. A local
 * mutation moves the fingerprint too, so the poll returns and invalidates what
 * you just changed — one extra GET per mutation. Recognising your own writes
 * would mean threading a client id through every write path; the refetch is
 * cheap and self-correcting, that would not be.
 */
export function useLiveSync(authenticated: boolean): void {
  const qc = useQueryClient()

  useEffect(() => {
    if (!authenticated) return
    const loop = createChangeLoop({
      fetchChanges: (since, wait, signal) => api.changes(since, wait, signal),
      invalidate: (queryKey) => void qc.invalidateQueries({ queryKey }),
      isHidden: () => document.hidden,
    })
    loop.start()

    const onWake = () => loop.wake()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      loop.stop()
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [authenticated, qc])
}
