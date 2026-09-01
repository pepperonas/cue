import { describe, expect, it, vi } from 'vitest'
import { DEMO_PATH, LANDING_PATH, pushRoute, routeFrom } from './route'

describe('routeFrom', () => {
  it('recognises the landing page', () => {
    expect(routeFrom(LANDING_PATH)).toBe('landing')
  })

  it('tolerates the shapes a hand-shared URL actually has', () => {
    // A trailing slash and a capital letter are what people paste, not what
    // the code emits — treating them as "unknown" would show the app to
    // someone who asked for the landing page.
    expect(routeFrom('/willkommen/')).toBe('landing')
    expect(routeFrom('/Willkommen')).toBe('landing')
    expect(routeFrom('/WILLKOMMEN//')).toBe('landing')
  })

  it('sends everything else to the app', () => {
    // The SPA fallback serves the shell for every path there is, so an unknown
    // one must land somewhere real rather than on a blank page.
    expect(routeFrom('/')).toBe('app')
    expect(routeFrom('')).toBe('app')
    expect(routeFrom('/board')).toBe('app')
    expect(routeFrom('/willkommen-extra')).toBe('app')
    expect(routeFrom('/x/willkommen')).toBe('app')
  })
})

describe('pushRoute', () => {
  it('pushes a new route and reports that it did', () => {
    const history = { pushState: vi.fn() }
    expect(pushRoute(LANDING_PATH, history, '/')).toBe(true)
    expect(history.pushState).toHaveBeenCalledWith({}, '', LANDING_PATH)
  })

  it('does not push the route it is already on', () => {
    // A duplicate entry would make the back button need two presses to do one
    // thing — the classic "back is broken" report.
    const history = { pushState: vi.fn() }
    expect(pushRoute(LANDING_PATH, history, LANDING_PATH)).toBe(false)
    expect(history.pushState).not.toHaveBeenCalled()
  })

  it('treats the shapes of one address as being there already', () => {
    // `/willkommen/` IS the landing page. Pushing a normalised duplicate would
    // add a history entry for a navigation that changes nothing — the very
    // double-entry the guard exists for. (Written the other way round first;
    // the code was right and the expectation was not.)
    const history = { pushState: vi.fn() }
    expect(pushRoute(LANDING_PATH, history, '/willkommen/')).toBe(false)
    expect(pushRoute(LANDING_PATH, history, '/Willkommen')).toBe(false)
    expect(history.pushState).not.toHaveBeenCalled()
  })
})

describe('the demo route', () => {
  it('is its own address', () => {
    // Teilbar und nachladbar: wer den Link bekommt, landet in der Demo und
    // nicht auf einer Anmeldeseite.
    expect(routeFrom(DEMO_PATH)).toBe('demo')
    expect(DEMO_PATH).toBe('/demo')
  })

  it('tolerates the same shapes as the landing page', () => {
    expect(routeFrom('/demo/')).toBe('demo')
    expect(routeFrom('/Demo')).toBe('demo')
  })

  it('does not swallow neighbouring paths', () => {
    expect(routeFrom('/demonstration')).toBe('app')
    expect(routeFrom('/x/demo')).toBe('app')
  })

  it('is a third route, not a second landing page', () => {
    // Sonst bekäme der Besucher die Erklärseite statt der Demo.
    expect(routeFrom(DEMO_PATH)).not.toBe(routeFrom(LANDING_PATH))
  })
})
