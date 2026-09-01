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

describe('copyText — the paths that throw rather than return', () => {
  it('reports false when execCommand THROWS instead of returning false', () => {
    // A sandboxed iframe without allow-clipboard-write does exactly this, and
    // an uncaught throw here would take the whole copy action down with it.
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    document.execCommand = vi.fn(() => {
      throw new Error('blocked by sandbox')
    }) as unknown as typeof document.execCommand
    return expect(copyText('boom')).resolves.toBe(false)
  })

  it('leaves no helper textarea behind when the copy blows up', async () => {
    // The element is appended before the copy; an early throw used to be the
    // way an invisible textarea could pile up on the page.
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    document.execCommand = vi.fn(() => {
      throw new Error('blocked')
    }) as unknown as typeof document.execCommand
    const before = document.querySelectorAll('textarea').length
    await copyText('x')
    expect(document.querySelectorAll('textarea').length).toBe(before)
  })

  it('skips the async API outside a secure context', async () => {
    // http:// on a LAN address: the API exists but is not allowed to be used,
    // so going straight to the fallback is what makes copy work there at all.
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('isSecureContext', false)
    document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand
    expect(await copyText('lan')).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('vibrate — a hostile navigator', () => {
  it('swallows an implementation that throws', () => {
    // Some browsers throw on vibrate() outside a user gesture. Haptics are
    // decoration; they must never break the action they decorate.
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('needs a user gesture')
      },
    })
    expect(() => vibrate(10)).not.toThrow()
  })

  it('defaults to a short pulse', () => {
    const fn = vi.fn()
    vi.stubGlobal('navigator', { vibrate: fn })
    vibrate()
    expect(fn).toHaveBeenCalledWith(10)
  })
})
