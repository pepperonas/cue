// Media-query hooks. The board renders a different structure on phones, and
// that decision must react to rotation and split-view resizes — a one-off
// `window.innerWidth` read would freeze at the value it had on mount.
import { useEffect, useState } from 'react'

/** Below this the board stacks its status columns (matches the CSS breakpoint). */
export const MOBILE_QUERY = '(max-width: 900px)'

/** True while `query` matches; updates on resize/rotation. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    // Safari < 14 only has the deprecated listener API.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [query])

  return matches
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
