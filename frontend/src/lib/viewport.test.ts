import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyViewportVars,
  subscribeToViewport,
  viewportVars,
} from './viewport'
import type { ViewportLike } from './viewport'

const vv = (height: number, offsetTop = 0): ViewportLike => ({ height, offsetTop })

describe('viewportVars', () => {
  it('reports nothing to correct when the visible area IS the window', () => {
    // Desktop, and any phone without a keyboard up. Returning values here would
    // freeze a pixel height into a stylesheet that wants `100dvh`.
    expect(viewportVars(vv(844), 844)).toBeNull()
  })

  it('reports the visible height once a keyboard covers part of the screen', () => {
    // The case the feature exists for: the layout viewport still says 844.
    expect(viewportVars(vv(554), 844)).toEqual({ height: '554px', top: '0px' })
  })

  it('reports how far the visible area slid down', () => {
    // iOS scrolls the page instead of resizing it, so a fixed-position scrim
    // stays behind unless it is pushed down by the same amount.
    expect(viewportVars(vv(554, 120), 844)).toEqual({ height: '554px', top: '120px' })
  })

  it('ignores sub-pixel noise', () => {
    // Chrome reports fractional heights on scaled displays. Rewriting the
    // variables for those would restyle every open dialog for nothing.
    expect(viewportVars(vv(843.5), 844)).toBeNull()
    expect(viewportVars(vv(844, 0.5), 844)).toBeNull()
  })

  it('rounds what it does report', () => {
    expect(viewportVars(vv(553.6, 120.4), 844)).toEqual({ height: '554px', top: '120px' })
  })

  it('falls back to the stylesheet when the API is missing or nonsense', () => {
    // Firefox on some platforms, older WebViews, and SSR.
    expect(viewportVars(null, 844)).toBeNull()
    expect(viewportVars(undefined, 844)).toBeNull()
    expect(viewportVars(vv(0), 844)).toBeNull()
    expect(viewportVars(vv(Number.NaN), 844)).toBeNull()
  })
})

describe('subscribeToViewport', () => {
  it('listens to resize AND scroll', () => {
    // resize = the keyboard opened; scroll = the visible area slid (iOS).
    const add = vi.fn()
    const remove = vi.fn()
    const target: ViewportLike = {
      height: 800,
      offsetTop: 0,
      addEventListener: add,
      removeEventListener: remove,
    }
    const onChange = () => {}

    const off = subscribeToViewport(target, onChange)
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll'])

    off()
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll'])
  })

  it('is a no-op without the API, and its unsubscribe stays callable', () => {
    const off = subscribeToViewport(null, () => {})
    expect(() => off()).not.toThrow()
  })
})

describe('applyViewportVars', () => {
  const fakeEl = () => {
    const props = new Map<string, string>()
    return {
      props,
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
        removeProperty: (k: string) => void props.delete(k),
      },
    }
  }

  it('writes both variables', () => {
    const el = fakeEl()
    applyViewportVars(el, { height: '554px', top: '120px' })
    expect(el.props.get('--vvh')).toBe('554px')
    expect(el.props.get('--vv-top')).toBe('120px')
  })

  it('clears them again when the keyboard closes', () => {
    // Leaving a stale height behind would pin every dialog to the size the
    // screen had while a keyboard was open.
    const el = fakeEl()
    applyViewportVars(el, { height: '554px', top: '120px' })
    applyViewportVars(el, null)
    expect(el.props.has('--vvh')).toBe(false)
    expect(el.props.has('--vv-top')).toBe(false)
  })
})

describe('installViewportVars', () => {
  const withViewport = (vv: unknown, innerHeight = 844) => {
    const listeners: Record<string, (() => void)[]> = {}
    const target = vv as { addEventListener?: unknown }
    if (target && typeof target === 'object') {
      Object.assign(target, {
        addEventListener: (type: string, fn: () => void) => {
          ;(listeners[type] ??= []).push(fn)
        },
        removeEventListener: (type: string, fn: () => void) => {
          listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
        },
      })
    }
    vi.stubGlobal('visualViewport', vv)
    vi.stubGlobal('innerHeight', innerHeight)
    return {
      fire: (type: string) => (listeners[type] ?? []).forEach((f) => f()),
      count: (type: string) => (listeners[type] ?? []).length,
    }
  }
  const root = () => document.documentElement.style.getPropertyValue('--vvh')

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.style.removeProperty('--vvh')
    document.documentElement.style.removeProperty('--vv-top')
  })

  it('writes the variables straight away, before any event fires', async () => {
    // The keyboard can already be open when a dialog mounts (tap a field, then
    // open the composer from a shortcut) — waiting for a resize would size the
    // first render to the full screen.
    const { installViewportVars } = await import('./viewport')
    withViewport({ height: 554, offsetTop: 0 })
    const stop = installViewportVars()
    expect(root()).toBe('554px')
    stop()
  })

  it('follows the viewport as the keyboard opens and closes', async () => {
    const { installViewportVars } = await import('./viewport')
    const vv = { height: 844, offsetTop: 0 }
    const ctl = withViewport(vv)
    const stop = installViewportVars()
    expect(root()).toBe('')

    vv.height = 554
    ctl.fire('resize')
    expect(root()).toBe('554px')

    vv.height = 844
    ctl.fire('resize')
    expect(root(), 'a stale height would pin every dialog to keyboard size').toBe('')
    stop()
  })

  it('unsubscribes everything it subscribed to', async () => {
    const { installViewportVars } = await import('./viewport')
    const ctl = withViewport({ height: 844, offsetTop: 0 })
    const stop = installViewportVars()
    expect(ctl.count('resize') + ctl.count('scroll')).toBe(2)
    stop()
    expect(ctl.count('resize') + ctl.count('scroll')).toBe(0)
  })

  it('is harmless where the API does not exist', async () => {
    const { installViewportVars } = await import('./viewport')
    withViewport(undefined)
    const stop = installViewportVars()
    expect(root()).toBe('')
    expect(() => stop()).not.toThrow()
  })
})
