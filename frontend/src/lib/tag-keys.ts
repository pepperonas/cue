/**
 * What a key press means in the tag field.
 *
 * The field has two ways to end a tag and they mean different things:
 *
 *   → / Tab            take the SUGGESTION (the grey completion / highlighted row)
 *   Enter / Space / ,  take WHAT WAS TYPED, verbatim
 *
 * Kept pure and separate from the component because this table is the feature:
 * the trap risk (Tab must still move focus when there is nothing to complete),
 * the Cmd+Enter passthrough (that shortcut saves the prompt) and the scoping of
 * Escape (close the menu, not the dialog) are all decided here, and none of them
 * is observable from a rendered component without a browser.
 */

export type TagKeyAction =
  /** Commit the highlighted suggestion. */
  | 'takeSuggestion'
  /** Commit the typed text as its own tag. */
  | 'takeTyped'
  | 'moveDown'
  | 'moveUp'
  | 'openMenu'
  /** Close the suggestion list — and keep the key away from the dialog. */
  | 'closeMenu'
  /** Consume the key without doing anything (a separator with nothing to end). */
  | 'swallow'
  /** Not ours: let the browser and the dialog have it. */
  | 'pass'

export interface TagKeyState {
  /** A non-empty token is being typed after the last comma. */
  typing: boolean
  menuOpen: boolean
  /** There is a row to take. */
  hasSuggestion: boolean
  /** Caret sits at the very end of the field. */
  caretAtEnd: boolean
}

export interface TagKeyEvent {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

/** Everything except `pass` is handled by us and gets `preventDefault()`. */
export function isHandled(action: TagKeyAction): boolean {
  return action !== 'pass'
}

export function tagKeyAction(e: TagKeyEvent, s: TagKeyState): TagKeyAction {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (s.menuOpen && s.hasSuggestion) return e.key === 'ArrowDown' ? 'moveDown' : 'moveUp'
    return e.key === 'ArrowDown' ? 'openMenu' : 'pass'
  }

  if (e.key === 'Escape') {
    // Only ours while the list is open; otherwise the dialog gets to close.
    return s.menuOpen ? 'closeMenu' : 'pass'
  }

  // Cmd/Ctrl+Enter saves the prompt. No combination means anything in here, and
  // swallowing one would break a shortcut that works everywhere else.
  if (e.metaKey || e.ctrlKey || e.altKey) return 'pass'

  if (e.key === 'Tab' || (e.key === 'ArrowRight' && s.caretAtEnd)) {
    // ⚠️ Only while a token is being typed. With an empty token the list still
    // shows tags, and taking one on Tab would trap the keyboard in this field:
    // every commit re-opens the list, so no press would ever move focus on.
    return s.typing && s.menuOpen && s.hasSuggestion ? 'takeSuggestion' : 'pass'
  }

  if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
    if (s.typing) return 'takeTyped'
    // Nothing to end: eat the separators so stray blanks and empty segments
    // cannot pile up. Enter has no literal meaning in a text input anyway.
    return e.key === 'Enter' ? 'pass' : 'swallow'
  }

  return 'pass'
}
