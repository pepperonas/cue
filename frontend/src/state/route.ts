import { useCallback, useEffect, useState } from 'react'
import { DEMO_PATH, LANDING_PATH, pushRoute, routeFrom, type Route } from '../lib/route'

/**
 * The current route, and a way to change it — the React half of `lib/route.ts`.
 *
 * Same split as `live-sync`: the rules are framework-free and unit tested over
 * there, this file is only the wiring to `popstate` and to component state.
 *
 * ⚠️ Listening to `popstate` here does not fight the overlay stack. Its
 * entries are pushed WITHOUT a URL, so closing a dialog with the back gesture
 * leaves the path exactly as it was and this hook re-reads the same route —
 * see the note in `lib/route.ts`.
 */
export function useRoute(): {
  route: Route
  toLanding: () => void
  toDemo: () => void
  toApp: () => void
} {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const go = useCallback((target: string) => {
    // `pushRoute` refuses a duplicate, so a second click on the same entry
    // does not pile up history the back button then has to unwind.
    if (pushRoute(target, window.history, window.location.pathname)) {
      setPath(window.location.pathname)
      // A page change, not a scroll position to restore: arriving at the top
      // is what every other navigation in this app does.
      window.scrollTo({ top: 0 })
    }
  }, [])

  return {
    route: routeFrom(path),
    toLanding: useCallback(() => go(LANDING_PATH), [go]),
    toDemo: useCallback(() => go(DEMO_PATH), [go]),
    toApp: useCallback(() => go('/'), [go]),
  }
}
