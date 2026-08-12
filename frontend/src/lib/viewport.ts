/**
 * Make dialogs fit the part of the screen the on-screen keyboard leaves over.
 *
 * A phone keyboard does not shrink the layout viewport. `100vh`, `100dvh` and
 * `inset: 0` all keep describing the full screen, so a bottom-anchored sheet
 * keeps its buttons exactly where the keyboard now is — you type into a field
 * and the "Anlegen" button you are typing towards is underneath the keys.
 *
 * `window.visualViewport` is the one API that reports what is actually
 * visible. This module mirrors it into two CSS variables that the sheets size
 * themselves from:
 *
 *   --vvh      height of the visible area
 *   --vv-top   how far that area has slid down the layout viewport
 *
 * `--vv-top` matters on iOS specifically: it does not support the viewport
 * meta's `interactive-widget` hint, and it scrolls the page rather than
 * resizing it, so a `position: fixed` scrim stays pinned to the layout
 * viewport while the visible area slides out from under it.
 *
 * The measuring is split from the applying so the arithmetic can be tested
 * without a browser — same reason `media.ts` exports `subscribeToMedia`.
 */

export interface ViewportLike {
  height: number
  offsetTop: number
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

/** CSS variable values for a visual viewport, or `null` when there is nothing
 *  to correct — an unsupported browser, or a plain desktop window where the
 *  visible area IS the layout viewport. Returning `null` leaves the stylesheet
 *  default (`100dvh`) in charge instead of freezing a pixel height into it. */
export function viewportVars(
  vv: ViewportLike | null | undefined,
  layoutHeight: number,
): { height: string; top: string } | null {
  if (!vv || !Number.isFinite(vv.height) || vv.height <= 0) return null
  // A rounding difference is not a keyboard. Chrome reports fractional heights
  // on zoomed displays, and rewriting the variables on every one of those
  // would restyle every open dialog for nothing.
  const shrunk = layoutHeight - vv.height > 1
  const slid = Math.abs(vv.offsetTop) > 1
  if (!shrunk && !slid) return null
  return { height: `${Math.round(vv.height)}px`, top: `${Math.round(vv.offsetTop)}px` }
}

/** Subscribe to both events the visual viewport can change through. Returns an
 *  unsubscribe. (`scroll` fires when the visible area slides on iOS; `resize`
 *  when the keyboard opens or closes.) */
export function subscribeToViewport(vv: ViewportLike | null, onChange: () => void): () => void {
  if (!vv?.addEventListener) return () => {}
  vv.addEventListener('resize', onChange)
  vv.addEventListener('scroll', onChange)
  return () => {
    vv.removeEventListener?.('resize', onChange)
    vv.removeEventListener?.('scroll', onChange)
  }
}

/** Write the variables onto an element (the document root in practice), or
 *  clear them when there is nothing to correct. */
export function applyViewportVars(
  el: { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void } },
  vars: { height: string; top: string } | null,
): void {
  if (!vars) {
    el.style.removeProperty('--vvh')
    el.style.removeProperty('--vv-top')
    return
  }
  el.style.setProperty('--vvh', vars.height)
  el.style.setProperty('--vv-top', vars.top)
}

/** Keep the root element's viewport variables in step for the app's lifetime. */
export function installViewportVars(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const vv = (window as Window & { visualViewport?: ViewportLike }).visualViewport ?? null
  const update = () => applyViewportVars(document.documentElement, viewportVars(vv, window.innerHeight))
  update()
  const off = subscribeToViewport(vv, update)
  window.addEventListener('orientationchange', update)
  return () => {
    off()
    window.removeEventListener('orientationchange', update)
  }
}
