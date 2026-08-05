import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_QUERY, matchMediaOrNull, subscribeToMedia, type MediaQueryLike } from './media'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeToMedia', () => {
  it('uses the modern listener API when it exists', () => {
    const add = vi.fn()
    const remove = vi.fn()
    const mql: MediaQueryLike = { matches: false, addEventListener: add, removeEventListener: remove }
    const onChange = () => {}

    const off = subscribeToMedia(mql, onChange)
    expect(add).toHaveBeenCalledWith('change', onChange)
    expect(remove).not.toHaveBeenCalled()

    off()
    // The SAME handler must come back off, or every re-subscribe leaks one.
    expect(remove).toHaveBeenCalledWith('change', onChange)
  })

  it('falls back to the deprecated pair on Safari < 14', () => {
    // Without this branch the board never learns about a rotation there.
    const add = vi.fn()
    const remove = vi.fn()
    const mql: MediaQueryLike = { matches: true, addListener: add, removeListener: remove }
    const onChange = () => {}

    const off = subscribeToMedia(mql, onChange)
    expect(add).toHaveBeenCalledWith(onChange)

    off()
    expect(remove).toHaveBeenCalledWith(onChange)
  })

  it('never mixes the two APIs', () => {
    const modern = { add: vi.fn(), remove: vi.fn() }
    const legacy = { add: vi.fn(), remove: vi.fn() }
    const mql: MediaQueryLike = {
      matches: false,
      addEventListener: modern.add,
      removeEventListener: modern.remove,
      addListener: legacy.add,
      removeListener: legacy.remove,
    }

    subscribeToMedia(mql, () => {})()
    expect(legacy.add).not.toHaveBeenCalled()
    expect(legacy.remove).not.toHaveBeenCalled()
  })

  it('survives a matcher that offers no listener API at all', () => {
    const off = subscribeToMedia({ matches: false }, () => {})
    expect(() => off()).not.toThrow()
  })
})

describe('matchMediaOrNull', () => {
  it('returns the matcher when the browser has one', () => {
    const mql = { matches: true }
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
    expect(matchMediaOrNull(MOBILE_QUERY)).toBe(mql)
  })

  it('returns null instead of throwing where matchMedia is missing', () => {
    // SSR and older test environments; callers read that as "does not match"
    // rather than crashing the board.
    vi.stubGlobal('matchMedia', undefined)
    expect(matchMediaOrNull(MOBILE_QUERY)).toBeNull()
  })
})

describe('MOBILE_QUERY', () => {
  it('matches the CSS breakpoint the mobile board layout is written against', () => {
    // global.css switches the board to collapsible sections at the same width;
    // if the two drift apart the layout and its logic disagree.
    expect(MOBILE_QUERY).toBe('(max-width: 900px)')
  })
})
