// Back-navigation stack for overlays.
//
// The app is a single view with no router, so without this every "back"
// (Android gesture, iOS swipe, browser button) leaves the PWA — even with three
// dialogs open. The fix is a LIFO stack of open overlays, each mirrored by one
// `history.pushState` entry: back pops the topmost overlay, and only an empty
// stack lets the browser navigate away for real.
//
// This module is the pure state machine (no React, no DOM) so the tricky part —
// telling apart "the user pressed back" from "the UI closed the dialog itself"
// without double-closing or double-navigating — is unit testable.

export interface BackEntry {
  /** Stable key of the overlay instance. */
  id: string
  /** Invoked when this entry is dismissed by a back navigation. */
  close: () => void
  /** False once the browser consumed this entry's history record. */
  pushed: boolean
}

/** Side effects the caller has to perform after a stack operation. */
export type BackEffect =
  | { type: 'push' }
  /** Step back in history; the resulting popstate must be ignored. */
  | { type: 'back' }
  | { type: 'none' }

export class BackStack {
  private entries: BackEntry[] = []

  get size(): number {
    return this.entries.length
  }

  get ids(): string[] {
    return this.entries.map((e) => e.id)
  }

  peek(): BackEntry | undefined {
    return this.entries[this.entries.length - 1]
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id)
  }

  /** Register a freshly opened overlay. Duplicate ids are ignored. */
  push(id: string, close: () => void): BackEffect {
    if (this.has(id)) return { type: 'none' }
    this.entries.push({ id, close, pushed: true })
    return { type: 'push' }
  }

  /**
   * Remove an overlay that closed on its own (✕, backdrop, Escape, unmount).
   *
   * Its history record has to go too, otherwise the next back press would be
   * swallowed by a stale entry. Only the TOP entry can trigger that safely — a
   * dialog closing underneath another one just drops out of the stack, and the
   * one history step it leaves behind is consumed later by the entry above it.
   */
  remove(id: string): BackEffect {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) return { type: 'none' }
    const [entry] = this.entries.splice(index, 1)
    const wasTop = index === this.entries.length
    return entry.pushed && wasTop ? { type: 'back' } : { type: 'none' }
  }

  /**
   * The browser went back. Closes the topmost overlay and reports whether the
   * navigation was handled; `false` means the stack was empty and the app
   * should let the browser leave.
   */
  handlePop(): boolean {
    const entry = this.entries.pop()
    if (!entry) return false
    // Its history record is already gone — never step back for it again.
    entry.pushed = false
    entry.close()
    return true
  }

  /** Close the topmost overlay programmatically (Escape). */
  closeTop(): boolean {
    const entry = this.peek()
    if (!entry) return false
    entry.close()
    return true
  }

  /** Test/reset helper. */
  clear(): void {
    this.entries = []
  }
}

/** Marker written into `history.state` so foreign entries stay untouched. */
export const BACK_STATE_KEY = 'cueOverlay'

export function isOverlayState(state: unknown): boolean {
  return !!state && typeof state === 'object' && BACK_STATE_KEY in (state as object)
}
