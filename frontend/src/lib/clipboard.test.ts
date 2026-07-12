import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, vibrate } from './clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('uses the async clipboard API in a secure context', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('isSecureContext', true)
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to the legacy textarea+execCommand path when the API fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) },
    })
    vi.stubGlobal('isSecureContext', true)
    const exec = vi.fn(() => true)
    document.execCommand = exec as unknown as typeof document.execCommand
    expect(await copyText('fallback')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    // The helper textarea was cleaned up again.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports false when every strategy fails', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand
    expect(await copyText('nope')).toBe(false)
  })
})

describe('vibrate', () => {
  it('forwards the pattern when supported and never throws when not', () => {
    const fn = vi.fn()
    vi.stubGlobal('navigator', { vibrate: fn })
    vibrate([5, 10])
    expect(fn).toHaveBeenCalledWith([5, 10])

    vi.stubGlobal('navigator', {})
    expect(() => vibrate()).not.toThrow()
  })
})
