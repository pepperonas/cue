import { describe, expect, it } from 'vitest'
import { isOptimizable, optimizeState,
  tapAction,
  holdAction } from './optimization'
import { STATUSES } from './types'

describe('isOptimizable', () => {
  it('allows exactly the queue', () => {
    expect(isOptimizable({ status: 'queued' })).toBe(true)
  })

  it('refuses every status a prompt reaches after it has been used', () => {
    // Optimizing rewrites the text you are ABOUT to send. Once a prompt is
    // running or done that text is history; failed and archived are out for
    // the same reason, and moving one back to the queue makes it eligible.
    for (const status of ['running', 'done', 'failed', 'archived'] as const) {
      expect(isOptimizable({ status }), status).toBe(false)
    }
  })

  it('is checked against every status the app knows', () => {
    // Pinning the whole list means a status added later shows up here as a
    // failing test rather than silently inheriting "not optimizable".
    expect(STATUSES).toEqual(['queued', 'running', 'done', 'failed', 'archived'])
    expect(STATUSES.filter((s) => isOptimizable({ status: s }))).toEqual(['queued'])
  })
})

describe('optimizeState', () => {
  const base = {
    optimized: false,
    optimization_applied_at: null as string | null,
    optimized_manually: null as boolean | null,
  }

  it('is "none" for a prompt nobody has optimized', () => {
    expect(optimizeState(base)).toBe('none')
  })

  it('is "applied" once a proposal was accepted into the body', () => {
    expect(optimizeState({ ...base, optimization_applied_at: '2026-08-23T10:00:00Z' })).toBe('applied')
  })

  it('is "pending" while a proposal waits for a decision', () => {
    expect(optimizeState({ ...base, optimized: true })).toBe('pending')
  })

  it('ranks pending ABOVE applied when both hold', () => {
    // A prompt optimized last week with a fresh proposal on top: the pending
    // state is the one that asks something of the user, and the green "done"
    // tint would hide that request.
    expect(optimizeState({ optimized: true, optimization_applied_at: '2026-08-01T10:00:00Z' }))
      .toBe('pending')
  })

  it('treats a missing field as "not applied" rather than throwing', () => {
    // A response the service worker cached before the field existed.
    expect(optimizeState({ optimized: false })).toBe('none')
    expect(optimizeState({ optimized: true })).toBe('pending')
  })

  it('never returns a value outside the three the UI styles', () => {
    const seen = new Set<string>()
    for (const optimized of [true, false])
      for (const applied of [null, '2026-08-23T10:00:00Z'])
        seen.add(optimizeState({ optimized, optimization_applied_at: applied }))
    expect([...seen].sort()).toEqual(['applied', 'none', 'pending'])
  })
})

describe('Übersteuerung von Hand (0.72.0)', () => {
  const leer = { optimized: false, optimization_applied_at: null as string | null }
  const kiGruen = { ...leer, optimization_applied_at: '2026-08-01T10:00:00Z' }

  it('zeigt eine Markierung von Hand als eigenen Zustand', () => {
    expect(optimizeState({ ...leer, optimized_manually: true })).toBe('manual')
  })

  it('lässt einen Einwand die KI-Tatsache übersteuern', () => {
    // Ohne diesen Vorrang ließe sich ein grüner Indikator nicht zurücknehmen,
    // ohne `optimization_applied_at` zu löschen — also ohne Historie zu
    // fälschen.
    expect(optimizeState({ ...kiGruen, optimized_manually: false })).toBe('none')
  })

  it('lässt einen wartenden Vorschlag jeden Einwand schlagen', () => {
    expect(optimizeState({ ...kiGruen, optimized: true, optimized_manually: false }))
      .toBe('pending')
  })

  it('behandelt ein fehlendes Feld wie „kein Eingriff“, nicht wie false', () => {
    // Eine Antwort aus dem Service-Worker-Cache von vor diesem Feld.
    expect(optimizeState(kiGruen)).toBe('applied')
    expect(optimizeState({ ...kiGruen, optimized_manually: undefined })).toBe('applied')
  })
})

describe('tapAction', () => {
  it('öffnet alles, was schon einen Zustand hat', () => {
    expect(tapAction('pending')).toBe('open')
    expect(tapAction('applied')).toBe('open')
    expect(tapAction('manual')).toBe('open')
  })

  it('stößt nur auf dem leeren Knopf eine Optimierung an', () => {
    // ⚠️ Das ist die ganze Behebung: auf `pending` hat der Klick früher eine
    // neue Optimierung gestartet, obwohl der Tooltip „öffnen“ versprach.
    expect(tapAction('none')).toBe('optimize')
  })
})

describe('holdAction', () => {
  const leer = { optimized: false, optimization_applied_at: null as string | null }
  const kiGruen = { ...leer, optimization_applied_at: '2026-08-01T10:00:00Z' }

  it('optimiert erneut, solange ein Vorschlag wartet', () => {
    expect(holdAction({ ...leer, optimized: true })).toEqual({ kind: 'optimize' })
  })

  it('markiert einen leeren Prompt von Hand', () => {
    expect(holdAction(leer)).toEqual({ kind: 'manual', value: true })
  })

  it('nimmt eine Markierung von Hand wieder weg', () => {
    expect(holdAction({ ...leer, optimized_manually: true })).toEqual({
      kind: 'manual',
      value: null,
    })
  })

  it('nimmt ein KI-Grün zurück, ohne zu optimieren', () => {
    expect(holdAction(kiGruen)).toEqual({ kind: 'manual', value: false })
  })

  it('hebt einen Einwand wieder auf — und zwar zurück auf die KI-Tatsache', () => {
    // Genau das „und anders herum": jeder Zustand ist mit derselben Geste
    // erreichbar UND wieder verlassbar.
    expect(holdAction({ ...kiGruen, optimized_manually: false })).toEqual({
      kind: 'manual',
      value: null,
    })
  })

  it('ist in jedem Zustand umkehrbar', () => {
    // Eigenschaft statt Einzelfall: zweimal halten führt immer dahin zurück,
    // wo man war.
    const faelle: {
      optimized: boolean
      optimization_applied_at: string | null
      optimized_manually?: boolean | null
    }[] = [
      leer,
      { ...leer, optimized_manually: true },
      kiGruen,
      { ...kiGruen, optimized_manually: false },
    ]
    for (const start of faelle) {
      const erste = holdAction(start)
      if (erste.kind !== 'manual') continue
      const zwischen = { ...start, optimized_manually: erste.value }
      const zweite = holdAction(zwischen)
      expect(zweite).toEqual({ kind: 'manual', value: start.optimized_manually ?? null })
    }
  })
})
