import { describe, expect, it } from 'vitest'
import {
  KEIN_MODELL,
  badgeLabel,
  groupByProvider,
  isStale,
  modelOf,
  modelOptions,
  sortModels,
} from './models'
import type { AiModel } from './types'

function m(id: number, over: Partial<AiModel> = {}): AiModel {
  return {
    id,
    name: `M${id}`,
    provider: 'anthropic',
    provider_label: 'Claude Code',
    provider_short: 'CC',
    color: '#c96442',
    api_id: `api-${id}`,
    description: '',
    enabled: true,
    is_default: false,
    sort_order: id,
    usage: 0,
    ...over,
  }
}

describe('modelOf', () => {
  it('findet das zugeordnete Modell', () => {
    expect(modelOf([m(1), m(2)], 2)?.id).toBe(2)
  })
  it('gibt bei null und bei unbekannter id nichts zurück', () => {
    expect(modelOf([m(1)], null)).toBeUndefined()
    expect(modelOf([m(1)], 99)).toBeUndefined()
  })
})

describe('modelOptions', () => {
  it('führt „Kein Modell“ als erste Wahl', () => {
    const o = modelOptions([m(1)], null)
    expect(o[0].value).toBe(KEIN_MODELL)
    expect(o[0].label).toBe('Kein Modell')
  })

  it('bietet nur aktive Modelle an', () => {
    const o = modelOptions([m(1), m(2, { enabled: false })], null)
    expect(o.map((x) => x.value)).toEqual([KEIN_MODELL, 1])
  })

  it('behält ein deaktiviertes Modell, solange es DIESEM Prompt zugeordnet ist', () => {
    // Sonst stünde der Auslöser auf einem Wert, den seine Liste nicht kennt:
    // die Auswahl sähe leer aus, obwohl etwas zugeordnet ist.
    const o = modelOptions([m(1), m(2, { enabled: false })], 2)
    expect(o.map((x) => x.value)).toEqual([KEIN_MODELL, 1, 2])
    expect(o.find((x) => x.value === 2)?.label).toContain('deaktiviert')
  })

  it('nimmt ein deaktiviertes Modell nicht auf, wenn ein anderer Prompt es trägt', () => {
    const o = modelOptions([m(1), m(2, { enabled: false })], 1)
    expect(o.map((x) => x.value)).toEqual([KEIN_MODELL, 1])
  })

  it('trägt die Farbe als Punkt, damit Anbieter unterscheidbar bleiben', () => {
    const o = modelOptions([m(1, { color: '#abc' })], null)
    expect(o[1].dot).toBe('#abc')
  })
})

describe('badgeLabel', () => {
  it('nennt das Modell', () => {
    expect(badgeLabel(m(1, { name: 'Claude Opus 5' }))).toBe('Claude Opus 5')
  })
  it('fordert ohne Zuordnung zur Wahl auf', () => {
    expect(badgeLabel(undefined)).toBe('Modell wählen')
  })
})

describe('isStale', () => {
  it('gilt nur für ein vorhandenes, abgeschaltetes Modell', () => {
    expect(isStale(m(1, { enabled: false }))).toBe(true)
    expect(isStale(m(1))).toBe(false)
    expect(isStale(undefined)).toBe(false)
  })
})

describe('sortModels', () => {
  it('folgt der gezogenen Reihenfolge, dann der id', () => {
    const liste = [m(3, { sort_order: 2 }), m(1, { sort_order: 1 }), m(2, { sort_order: 2 })]
    expect(sortModels(liste).map((x) => x.id)).toEqual([1, 2, 3])
  })
  it('lässt die Eingabe unberührt', () => {
    const liste = [m(2, { sort_order: 2 }), m(1, { sort_order: 1 })]
    sortModels(liste)
    expect(liste.map((x) => x.id)).toEqual([2, 1])
  })
})

describe('groupByProvider', () => {
  it('fasst nach Anbieter zusammen und behält die Reihenfolge', () => {
    const liste = [
      m(1, { provider: 'anthropic', sort_order: 1 }),
      m(2, { provider: 'openai', provider_label: 'OpenAI Codex', sort_order: 2 }),
      m(3, { provider: 'anthropic', sort_order: 3 }),
    ]
    const g = groupByProvider(liste)
    expect(g.map((x) => x.provider)).toEqual(['anthropic', 'openai'])
    expect(g[0].models.map((x) => x.id)).toEqual([1, 3])
  })

  it('nimmt einen unbekannten Anbieter als eigene Gruppe auf', () => {
    // Die Architektur darf nicht auf die bekannten drei beschränkt sein.
    const g = groupByProvider([m(1, { provider: 'ollama', provider_label: '' })])
    expect(g[0].provider).toBe('ollama')
    expect(g[0].label).toBe('ollama')
  })
})
