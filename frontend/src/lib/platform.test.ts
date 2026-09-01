import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMac } from './platform'

describe('detectMac', () => {
  it('recognizes Apple platforms', () => {
    expect(detectMac('MacIntel')).toBe(true)
    expect(detectMac('macOS')).toBe(true)
    expect(detectMac('iPhone')).toBe(true)
    expect(detectMac('iPad')).toBe(true)
  })
  it('rejects Windows and Linux', () => {
    expect(detectMac('Win32')).toBe(false)
    expect(detectMac('Windows')).toBe(false)
    expect(detectMac('Linux x86_64')).toBe(false)
    expect(detectMac('')).toBe(false)
  })
})

describe('detectMac reading the browser itself', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers userAgentData over the deprecated navigator.platform', () => {
    // `navigator.platform` is deprecated and frozen to legacy values in some
    // browsers; the modern field is the one to believe.
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: 'Win32' })
    expect(detectMac()).toBe(true)
  })

  it('falls back to navigator.platform where userAgentData is missing', () => {
    // Safari and Firefox ship no userAgentData at all.
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(detectMac()).toBe(true)
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' })
    expect(detectMac()).toBe(false)
  })

  it('assumes non-Mac when the browser tells us nothing', () => {
    // Ctrl+Enter stays offered either way, so guessing wrong only mislabels a
    // hint — never removes the shortcut.
    vi.stubGlobal('navigator', {})
    expect(detectMac()).toBe(false)
  })
})

describe('detectMac — when the browser says nothing', () => {
  it('is false for a navigator that offers neither field', () => {
    // Reading `undefined` here and calling `.test()` on it would throw during
    // module init, i.e. a blank page — the guard matters more than its answer.
    vi.stubGlobal('navigator', {})
    expect(detectMac()).toBe(false)
  })

  it('prefers userAgentData over the deprecated platform string', () => {
    // navigator.platform is frozen/lied about by several browsers; the modern
    // source wins where both exist.
    vi.stubGlobal('navigator', {
      userAgentData: { platform: 'macOS' },
      platform: 'Win32',
    })
    expect(detectMac()).toBe(true)
  })

  it('falls back to platform when userAgentData carries nothing', () => {
    vi.stubGlobal('navigator', { userAgentData: {}, platform: 'MacIntel' })
    expect(detectMac()).toBe(true)
  })
})
