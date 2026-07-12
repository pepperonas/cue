import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardEnter, emphasized, prefersReducedMotion, springs } from './motion'

afterEach(() => vi.unstubAllGlobals())

describe('springs', () => {
  it('all presets are springs (spatial motion never uses duration easing)', () => {
    for (const t of Object.values(springs)) {
      expect((t as { type?: string }).type).toBe('spring')
    }
  })

  it('emphasized is the MD3 non-spatial easing', () => {
    const t = emphasized as { ease?: number[]; duration?: number }
    expect(t.ease).toEqual([0.2, 0, 0, 1])
    expect(t.duration).toBeGreaterThan(0)
  })
})

describe('prefersReducedMotion', () => {
  it('reflects the media query', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    expect(prefersReducedMotion()).toBe(true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('cardEnter', () => {
  it('staggers by index but caps the delay so long lists never crawl', () => {
    const at = (i: number) =>
      (cardEnter.show(i).transition as { delay: number }).delay
    expect(at(0)).toBe(0)
    expect(at(2)).toBeCloseTo(0.07)
    expect(at(50)).toBe(0.3) // capped
    expect(at(500)).toBe(0.3)
  })
})
