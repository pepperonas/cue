/**
 * The one piece of URL routing this app has.
 *
 * There is no router package here and this is not the beginning of one: every
 * view inside the app is a state value in `App.tsx` and the URL stays `/`.
 * Exactly one thing needs an address of its own — the landing page — because
 * an address is the whole point of it: a link you can send someone, a page a
 * reload stays on, a back button that works.
 *
 * ⚠️ Why this can safely listen to `popstate` next to the overlay stack: the
 * overlay entries in `state/overlays.tsx` are pushed as
 * `history.pushState(state, '')` — **no URL argument**, so they never move the
 * path. Closing a dialog with the back gesture therefore produces a popstate
 * whose path is unchanged, and `routeFrom` returns the same route. The two
 * histories are independent by construction, not by coordination.
 */

/** Address of the landing page. German, like every other user-facing string. */
export const LANDING_PATH = '/willkommen'

/** Adresse der Demo — die echte App auf erfundenen Daten, ohne Anmeldung. */
export const DEMO_PATH = '/demo'

export type Route = 'landing' | 'demo' | 'app'

/**
 * Which route a path names.
 *
 * Tolerant about the trailing slash and the case, because a hand-typed or
 * hand-shared URL has both; anything else is the app itself — an unknown path
 * must not produce a blank page, the SPA fallback serves the shell for every
 * path there is.
 */
export function routeFrom(pathname: string): Route {
  const path = normalize(pathname)
  if (path === LANDING_PATH) return 'landing'
  if (path === DEMO_PATH) return 'demo'
  return 'app'
}

/**
 * Push a route without reloading.
 *
 * Returns false when the path is already current — pushing a duplicate entry
 * would make the back button need two presses to do one thing.
 */
export function pushRoute(pathname: string, history: HistoryLike, current: string): boolean {
  if (normalize(current) === normalize(pathname)) return false
  history.pushState({}, '', pathname)
  return true
}

/** Same normalisation `routeFrom` uses, so "already there" means the same
 *  thing in both — `/Willkommen/` and `/willkommen` are one address. */
function normalize(pathname: string): string {
  return (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/'
}

/** The slice of `window.history` used here — keeps the tests DOM-free. */
export interface HistoryLike {
  pushState: (state: unknown, title: string, url?: string) => void
}
