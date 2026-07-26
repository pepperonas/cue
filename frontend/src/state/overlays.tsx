// Overlay/back-navigation binding.
//
// Every dialog, sheet, popover and lightbox registers here while it is open.
// The provider mirrors that stack into `history.pushState` entries, so the
// Android back gesture, the iOS back swipe and the browser back button close
// the topmost overlay instead of leaving the app — and Escape uses the exact
// same order, which removes the hand-maintained precedence chain that used to
// live in App.tsx.
//
// The state machine itself is `lib/backstack.ts` (pure + unit tested); this
// file only performs the effects it asks for and wires the DOM listeners.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { BACK_STATE_KEY, BackStack, type BackEffect } from '../lib/backstack'

interface OverlayApi {
  /** Register an open overlay; returns an unregister function. */
  register: (id: string, close: () => void) => () => void
  /** Close the topmost overlay (used by the global Escape handler). */
  closeTop: () => boolean
  /** How many overlays are currently open. */
  depthRef: React.MutableRefObject<number>
}

const OverlayContext = createContext<OverlayApi | null>(null)

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef(new BackStack())
  const depthRef = useRef(0)
  // Set while WE trigger history.back(); the popstate it causes is ours and
  // must not close a second overlay.
  const selfNavigating = useRef(false)

  const apply = useCallback((effect: BackEffect, id?: string) => {
    if (effect.type === 'push') {
      window.history.pushState({ [BACK_STATE_KEY]: id ?? true }, '')
    } else if (effect.type === 'back') {
      selfNavigating.current = true
      window.history.back()
    }
  }, [])

  // Unregistering is deferred by one frame. React StrictMode mounts effects
  // twice (mount → cleanup → mount) in development, and an immediate cleanup
  // would fire `history.back()` for an overlay that is about to re-register —
  // which navigates the app away. A re-register within the same frame cancels
  // the pending removal, so dev and production behave identically.
  const pendingRemoval = useRef(new Map<string, number>())

  const register = useCallback(
    (id: string, close: () => void) => {
      const pending = pendingRemoval.current.get(id)
      if (pending !== undefined) {
        cancelAnimationFrame(pending)
        pendingRemoval.current.delete(id)
      } else {
        apply(stackRef.current.push(id, close), id)
      }
      depthRef.current = stackRef.current.size
      return () => {
        const handle = requestAnimationFrame(() => {
          pendingRemoval.current.delete(id)
          apply(stackRef.current.remove(id))
          depthRef.current = stackRef.current.size
        })
        pendingRemoval.current.set(id, handle)
      }
    },
    [apply],
  )

  const closeTop = useCallback(() => stackRef.current.closeTop(), [])

  useEffect(() => {
    function onPopState() {
      if (selfNavigating.current) {
        // Our own history.back() — the overlay is already closing.
        selfNavigating.current = false
        depthRef.current = stackRef.current.size
        return
      }
      const handled = stackRef.current.handlePop()
      depthRef.current = stackRef.current.size
      if (!handled) {
        // Nothing open: let the browser navigation stand (leave the app / go
        // back to whatever came before). Nothing to do.
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const value = useMemo<OverlayApi>(
    () => ({ register, closeTop, depthRef }),
    [register, closeTop],
  )
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
}

function useOverlayApi(): OverlayApi | null {
  return useContext(OverlayContext)
}

/**
 * Make one overlay dismissible with the back gesture/button.
 *
 * Call it from the overlay component itself — it registers while mounted (or
 * while `enabled`) and unregisters on close, so nested dialogs stack
 * automatically in the order they appeared.
 *
 * ```tsx
 * function MyDialog({ onClose }) {
 *   useBackDismiss(onClose)
 *   …
 * }
 * ```
 */
export function useBackDismiss(onClose: () => void, enabled = true): void {
  const api = useOverlayApi()
  const id = useId()
  // Keep the latest callback without re-registering (which would push a second
  // history entry on every render).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!api || !enabled) return
    return api.register(id, () => closeRef.current())
  }, [api, enabled, id])
}

/** Escape handling for the global shortcut handler in App. */
export function useCloseTopOverlay(): () => boolean {
  const api = useOverlayApi()
  return useCallback(() => api?.closeTop() ?? false, [api])
}
