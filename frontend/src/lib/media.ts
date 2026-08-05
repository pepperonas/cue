// Media-query hooks. The board renders a different structure on phones, and
// that decision must react to rotation and split-view resizes — a one-off
// `window.innerWidth` read would freeze at the value it had on mount.
//
// The subscription is split out of the hook so the part that carries a real
// decision (which listener API to use) can be tested without a renderer.
import { useEffect, useState } from 'react'

/** Below this the board stacks its status columns (matches the CSS breakpoint). */
export const MOBILE_QUERY = '(max-width: 900px)'

/** What we actually use from a `MediaQueryList`. Safari < 14 ships only the
 *  deprecated listener pair, so both are optional. */
export interface MediaQueryLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

/** The live matcher, or null where `matchMedia` does not exist (SSR, old test
 *  environments). Callers treat null as "does not match". */
export function matchMediaOrNull(query: string): MediaQueryLike | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  return window.matchMedia(query)
}

/**
 * Listen for changes to a media query. Returns the unsubscribe.
 *
 * Prefers the modern `addEventListener`; falls back to the deprecated
 * `addListener` for Safari < 14, where the modern one simply is not there and
 * the board would never learn about a rotation.
 */
export function subscribeToMedia(mql: MediaQueryLike, onChange: () => void): () => void {
  if (mql.addEventListener) {
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }
  mql.addListener?.(onChange)
  return () => mql.removeListener?.(onChange)
}

/** True while `query` matches; updates on resize/rotation. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMediaOrNull(query)?.matches ?? false)

  useEffect(() => {
    const mql = matchMediaOrNull(query)
    if (!mql) return
    const onChange = () => setMatches(mql.matches)
    onChange()
    return subscribeToMedia(mql, onChange)
  }, [query])

  return matches
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
