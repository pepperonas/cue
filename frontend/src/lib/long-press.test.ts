import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, createLongPress } from './long-press'

/** Ein Zeitgeber, den der Test von Hand vorstellt — kein `setTimeout` nötig. */
function harness(overrides: Partial<Parameters<typeof createLongPress>[0]> = {}) {
  const jobs = new Map<number, { fn: () => void; ms: number }>()
  let nextId = 1
  const onLongPress = vi.fn()
  const press = createLongPress({
    onLongPress,
    schedule: (fn, ms) => {
      const id = nextId++
      jobs.set(id, { fn, ms })
      return id
    },
    unschedule: (id) => jobs.delete(id),
    ...overrides,
  })
  return {
    press,
    onLongPress,
    /** Alles laufen lassen, was noch geplant ist. */
    tick() {
      for (const [id, job] of [...jobs]) {
        jobs.delete(id)
        job.fn()
      }
    },
    pending: () => jobs.size,
    delays: () => [...jobs.values()].map((j) => j.ms),
  }
}

const AT = { x: 0, y: 0 }

describe('createLongPress', () => {
  it('fires after the delay and reports the press as long', () => {
    const h = harness()
    h.press.start(AT)
    expect(h.onLongPress).not.toHaveBeenCalled()
    h.tick()
    expect(h.onLongPress).toHaveBeenCalledTimes(1)
    // Das ist die Zusicherung, an der der Klick hängt: der Aufrufer erfährt,
    // dass er ihn schlucken muss.
    expect(h.press.end()).toBe(true)
  })

  it('uses the platform long-press delay', () => {
    const h = harness()
    h.press.start(AT)
    expect(h.delays()).toEqual([LONG_PRESS_MS])
  })

  it('does not fire on a quick tap, and lets the click through', () => {
    const h = harness()
    h.press.start(AT)
    expect(h.press.end()).toBe(false)
    h.tick() // was danach noch käme, darf nichts mehr auslösen
    expect(h.onLongPress).not.toHaveBeenCalled()
  })

  it('stops the clock on release — a long press must not fire into thin air', () => {
    // Ohne das liefe die Uhr weiter und träfe eine Karte, die niemand mehr
    // gedrückt hält.
    const h = harness()
    h.press.start(AT)
    h.press.end()
    expect(h.pending()).toBe(0)
  })

  it('fires exactly once however long the press is held', () => {
    const h = harness()
    h.press.start(AT)
    h.tick()
    h.tick()
    h.tick()
    expect(h.onLongPress).toHaveBeenCalledTimes(1)
  })

  it('cancels when the pointer wanders — that is a scroll, not a press', () => {
    const h = harness()
    h.press.start(AT)
    h.press.move({ x: LONG_PRESS_SLOP_PX + 1, y: 0 })
    h.tick()
    expect(h.onLongPress).not.toHaveBeenCalled()
    expect(h.press.end()).toBe(false)
  })

  it('tolerates the wobble of a finger holding still', () => {
    // Ein Finger liegt nie exakt still; wäre die Toleranz 0, funktionierte die
    // Geste auf Touch überhaupt nicht.
    const h = harness()
    h.press.start(AT)
    h.press.move({ x: 3, y: 3 })
    h.press.move({ x: -4, y: 2 })
    h.tick()
    expect(h.onLongPress).toHaveBeenCalledTimes(1)
  })

  it('measures the wobble from the start, not from the last point', () => {
    // Sonst käme man in beliebig vielen kleinen Schritten beliebig weit —
    // ein langsames Wischen wäre dann ein langer Druck.
    const h = harness()
    h.press.start(AT)
    for (let i = 1; i <= 6; i++) h.press.move({ x: i * 3, y: 0 })
    h.tick()
    expect(h.onLongPress).not.toHaveBeenCalled()
  })

  it("a cancelled press cannot swallow the NEXT press's click", () => {
    // `pointercancel` nach einem ausgelösten Halten wird von KEINEM Klick
    // gefolgt — bliebe die Marke stehen, verschluckte sie den nächsten.
    const h = harness()
    h.press.start(AT)
    h.tick()
    h.press.cancel()

    h.press.start(AT)
    expect(h.press.end()).toBe(false)
  })

  it('cancel stops a pending press', () => {
    const h = harness()
    h.press.start(AT)
    h.press.cancel()
    h.tick()
    expect(h.onLongPress).not.toHaveBeenCalled()
  })

  it('a second press starts a fresh clock instead of two', () => {
    const h = harness()
    h.press.start(AT)
    h.press.start(AT)
    expect(h.pending()).toBe(1)
    h.tick()
    expect(h.onLongPress).toHaveBeenCalledTimes(1)
  })

  it('moving after it already fired does not take it back', () => {
    const h = harness()
    h.press.start(AT)
    h.tick()
    h.press.move({ x: 500, y: 500 })
    expect(h.press.end()).toBe(true)
  })
})

describe('the default timer path', () => {
  // ⚠️ Every test above injects a fake scheduler, so the DEFAULT one — the code
  // that actually runs in a browser — had never executed once. Coverage showed
  // it as the one uncovered function in the module.
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after LONG_PRESS_MS of real (faked) time', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const press = createLongPress({ onLongPress })

    press.start({ x: 0, y: 0 })
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(press.end()).toBe(true)
  })

  it('really clears the timer on release, not just its own flag', () => {
    // Without a working default `unschedule` the callback would still arrive
    // long after the finger left — the failure mode is invisible to a test that
    // injects its own scheduler.
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const press = createLongPress({ onLongPress })

    press.start({ x: 0, y: 0 })
    press.end()
    vi.advanceTimersByTime(LONG_PRESS_MS * 5)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('honours a custom delay', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const press = createLongPress({ onLongPress, delayMs: 50 })
    press.start({ x: 0, y: 0 })
    vi.advanceTimersByTime(50)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
})
