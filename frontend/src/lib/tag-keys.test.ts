import { describe, expect, it } from 'vitest'
import { isHandled, tagKeyAction, type TagKeyState } from './tag-keys'

/** Mid-typing with a suggestion showing — the ordinary case. */
const TYPING: TagKeyState = {
  typing: true,
  menuOpen: true,
  hasSuggestion: true,
  caretAtEnd: true,
}
/** Right after a commit: the list is open, but nothing is being typed. */
const IDLE: TagKeyState = { ...TYPING, typing: false }

describe('taking the suggestion', () => {
  it('→ and Tab take it while a token is being typed', () => {
    expect(tagKeyAction({ key: 'Tab' }, TYPING)).toBe('takeSuggestion')
    expect(tagKeyAction({ key: 'ArrowRight' }, TYPING)).toBe('takeSuggestion')
  })

  it('⚠️ Tab moves focus when there is nothing to complete', () => {
    // Otherwise the keyboard is trapped: every commit re-opens the list, so
    // there would be no press left that leaves the field.
    expect(tagKeyAction({ key: 'Tab' }, IDLE)).toBe('pass')
    expect(isHandled(tagKeyAction({ key: 'Tab' }, IDLE))).toBe(false)
  })

  it('→ moves the caret when it is not at the end', () => {
    expect(tagKeyAction({ key: 'ArrowRight' }, { ...TYPING, caretAtEnd: false })).toBe('pass')
  })

  it('does nothing when the list has no row to take', () => {
    expect(tagKeyAction({ key: 'Tab' }, { ...TYPING, hasSuggestion: false })).toBe('pass')
    expect(tagKeyAction({ key: 'Tab' }, { ...TYPING, menuOpen: false })).toBe('pass')
  })
})

describe('taking what was typed', () => {
  it('Enter, Space and comma commit the typed text', () => {
    for (const key of ['Enter', ' ', ',']) {
      expect(tagKeyAction({ key }, TYPING)).toBe('takeTyped')
    }
  })

  it('never takes the suggestion instead', () => {
    // The whole point of the split: Enter means "mine", not "yours".
    expect(tagKeyAction({ key: 'Enter' }, TYPING)).not.toBe('takeSuggestion')
  })

  it('swallows a separator with nothing to end, but lets Enter through', () => {
    expect(tagKeyAction({ key: ' ' }, IDLE)).toBe('swallow')
    expect(tagKeyAction({ key: ',' }, IDLE)).toBe('swallow')
    expect(tagKeyAction({ key: 'Enter' }, IDLE)).toBe('pass')
  })
})

describe('keys that are not ours', () => {
  it('lets every Cmd/Ctrl/Alt combination through — Cmd+Enter saves the prompt', () => {
    expect(tagKeyAction({ key: 'Enter', metaKey: true }, TYPING)).toBe('pass')
    expect(tagKeyAction({ key: 'Enter', ctrlKey: true }, TYPING)).toBe('pass')
    expect(tagKeyAction({ key: 'Tab', altKey: true }, TYPING)).toBe('pass')
  })

  it('passes ordinary typing on', () => {
    expect(tagKeyAction({ key: 'a' }, TYPING)).toBe('pass')
    expect(tagKeyAction({ key: 'Backspace' }, TYPING)).toBe('pass')
  })
})

describe('Escape', () => {
  it('closes the list while it is open, and the dialog once it is not', () => {
    expect(tagKeyAction({ key: 'Escape' }, TYPING)).toBe('closeMenu')
    expect(tagKeyAction({ key: 'Escape' }, { ...TYPING, menuOpen: false })).toBe('pass')
  })
})

describe('arrow navigation', () => {
  it('walks the list when it is open', () => {
    expect(tagKeyAction({ key: 'ArrowDown' }, TYPING)).toBe('moveDown')
    expect(tagKeyAction({ key: 'ArrowUp' }, TYPING)).toBe('moveUp')
  })

  it('opens the list with ArrowDown when it is closed', () => {
    expect(tagKeyAction({ key: 'ArrowDown' }, { ...TYPING, menuOpen: false })).toBe('openMenu')
    expect(tagKeyAction({ key: 'ArrowUp' }, { ...TYPING, menuOpen: false })).toBe('pass')
  })
})
