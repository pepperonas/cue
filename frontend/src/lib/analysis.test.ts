import { describe, expect, it } from 'vitest'
import {
  abweichungen,
  boardFolge,
  layoutGraph,
  prioritaetsAenderungen,
  wartetAufEntscheidung,
  NODE_W,
  SPALTE_GAP,
  umbrechen,
  type AnalysisStep,
} from './analysis'
import type { Prompt } from './types'

function prompt(id: number, priority: Prompt['priority'] = 'normal'): Prompt {
  return {
    id,
    title: `P${id}`,
    body: '',
    status: 'queued',
    priority,
    sort_order: id,
    blocked: false,
    tested: false,
    test_closely: false,
    project_id: 1,
    tags: '',
  } as Prompt
}

function schritt(prompt_id: number, rang: number, prioritaet: AnalysisStep['prioritaet'] = null): AnalysisStep {
  return { prompt_id, rang, begruendung: '', prioritaet, ergaenzt: false }
}

const karte = (...p: Prompt[]) => new Map(p.map((x) => [x.id, x]))

describe('boardFolge', () => {
  it('lässt eine Folge ohne Prioritäten unverändert', () => {
    const steps = [schritt(3, 1), schritt(1, 2), schritt(2, 3)]
    expect(boardFolge(steps, karte(prompt(1), prompt(2), prompt(3)))).toEqual([3, 1, 2])
    expect(abweichungen(steps, karte(prompt(1), prompt(2), prompt(3)))).toBe(0)
  })

  it('zieht eine bestehende hohe Priorität über den Vorschlag', () => {
    // Genau die Falle: die KI will 1 zuerst, 2 steht aber auf „hoch".
    const steps = [schritt(1, 1), schritt(2, 2)]
    const prompts = karte(prompt(1), prompt(2, 'high'))
    expect(boardFolge(steps, prompts)).toEqual([2, 1])
    expect(abweichungen(steps, prompts)).toBe(2)
  })

  it('löst dieselbe Falle auf, wenn die KI die Priorität mitvorschlägt', () => {
    const steps = [schritt(1, 1, 'high'), schritt(2, 2)]
    const prompts = karte(prompt(1), prompt(2, 'high'))
    // 1 wird ebenfalls hoch -> gleiches Band -> die Folge gilt.
    expect(boardFolge(steps, prompts)).toEqual([1, 2])
    expect(abweichungen(steps, prompts)).toBe(0)
  })

  it('ignoriert Prompts, die es nicht mehr gibt', () => {
    const steps = [schritt(1, 1), schritt(99, 2)]
    expect(boardFolge(steps, karte(prompt(1)))).toEqual([1])
  })

  it('ist stabil bei gleichem Band', () => {
    const steps = [schritt(2, 1), schritt(1, 2), schritt(3, 3)]
    const prompts = karte(prompt(1), prompt(2), prompt(3))
    expect(boardFolge(steps, prompts)).toEqual([2, 1, 3])
  })
})

describe('prioritaetsAenderungen', () => {
  it('nennt nur die Schritte mit einem Vorschlag', () => {
    const steps = [schritt(1, 1, 'high'), schritt(2, 2), schritt(3, 3, 'low')]
    expect(prioritaetsAenderungen(steps).map((s) => s.prompt_id)).toEqual([1, 3])
  })
})

describe('wartetAufEntscheidung', () => {
  const basis = { status: 'succeeded', decision: 'pending', result: {} } as never
  it('gilt nur für ein fertiges, unentschiedenes Ergebnis', () => {
    expect(wartetAufEntscheidung(basis)).toBe(true)
    expect(wartetAufEntscheidung({ ...(basis as object), decision: 'applied' } as never)).toBe(false)
    expect(wartetAufEntscheidung({ ...(basis as object), status: 'failed' } as never)).toBe(false)
    expect(wartetAufEntscheidung({ ...(basis as object), result: null } as never)).toBe(false)
  })
})

describe('layoutGraph', () => {
  const titel = new Map([
    [1, 'Eins'],
    [2, 'Zwei'],
    [3, 'Drei'],
  ])

  it('macht aus jeder Phase eine Spalte', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1), schritt(2, 2), schritt(3, 3)],
        phasen: [
          { name: 'A', prompt_ids: [1, 2], ziel: '' },
          { name: 'B', prompt_ids: [3], ziel: '' },
        ],
        abhaengigkeiten: [],
      },
      titel,
    )
    expect(g.phasen.map((p) => p.name)).toEqual(['A', 'B'])
    expect(g.nodes.filter((n) => n.phase === 0).map((n) => n.id)).toEqual([1, 2])
    // Zweite Spalte steht genau eine Spaltenbreite + Abstand weiter rechts.
    expect(g.phasen[1].x - g.phasen[0].x).toBe(NODE_W + SPALTE_GAP)
  })

  it('zeichnet auch ohne Phasen einen Plan', () => {
    const g = layoutGraph(
      { reihenfolge: [schritt(1, 1), schritt(2, 2)], phasen: [], abhaengigkeiten: [] },
      titel,
    )
    expect(g.phasen).toHaveLength(1)
    expect(g.nodes.map((n) => n.id)).toEqual([1, 2])
  })

  it('lässt eine leere Phase keine leere Spalte erzeugen', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1)],
        phasen: [
          { name: 'leer', prompt_ids: [], ziel: '' },
          { name: 'voll', prompt_ids: [1], ziel: '' },
        ],
        abhaengigkeiten: [],
      },
      titel,
    )
    expect(g.phasen.map((p) => p.name)).toEqual(['voll'])
  })

  it('nimmt keinen Prompt auf, der nicht in der Reihenfolge steht', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1)],
        phasen: [{ name: 'A', prompt_ids: [1, 99], ziel: '' }],
        abhaengigkeiten: [],
      },
      titel,
    )
    expect(g.nodes.map((n) => n.id)).toEqual([1])
  })

  it('verwirft Kanten zu Knoten, die nicht gezeichnet werden', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1)],
        phasen: [],
        abhaengigkeiten: [
          { von: 1, nach: 99, grund: '' },
          { von: 99, nach: 1, grund: '' },
        ],
      },
      titel,
    )
    expect(g.edges).toHaveLength(0)
  })

  it('verbindet direkt benachbarte Karten mit einer geraden Strecke', () => {
    // Ein Bogen zeigte hier in die Nachbarspalte und las sich als Verbindung
    // dorthin (im Browser aufgefallen, nicht im Test).
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1), schritt(2, 2)],
        phasen: [{ name: 'A', prompt_ids: [1, 2], ziel: '' }],
        abhaengigkeiten: [{ von: 1, nach: 2, grund: '' }],
      },
      titel,
    )
    const [a, b] = g.nodes
    expect(g.edges[0].d).toBe(`M ${a.x + a.w / 2} ${a.y + a.h} L ${b.x + b.w / 2} ${b.y}`)
  })

  it('führt eine Kante über eine Karte hinweg außen herum', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1), schritt(2, 2), schritt(3, 3)],
        phasen: [{ name: 'A', prompt_ids: [1, 2, 3], ziel: '' }],
        abhaengigkeiten: [{ von: 1, nach: 3, grund: '' }],
      },
      titel,
    )
    // Sie ENDET an der rechten Kante des Ziels — sonst liefe sie durch die Karte.
    // ⚠️ Geprüft wird der Endpunkt, nicht ein Vorkommen: in einer Spalte ist
    // `ziel.x + ziel.w` genau der Startpunkt, eine Suche danach träfe das „M"
    // und wäre in beide Richtungen erfüllt (per Mutationsprobe gefunden).
    const ziel = g.nodes.find((n) => n.id === 3)!
    expect(endpunkt(g.edges[0].d)).toBe(ziel.x + ziel.w)
  })

  it('führt eine Kante zwischen Spalten an die LINKE Kante des Ziels', () => {
    const g = layoutGraph(
      {
        reihenfolge: [schritt(1, 1), schritt(2, 2)],
        phasen: [
          { name: 'A', prompt_ids: [1], ziel: '' },
          { name: 'B', prompt_ids: [2], ziel: '' },
        ],
        abhaengigkeiten: [{ von: 1, nach: 2, grund: '' }],
      },
      titel,
    )
    const ziel = g.nodes.find((n) => n.id === 2)!
    expect(endpunkt(g.edges[0].d)).toBe(ziel.x)
  })

  it('wächst in der Höhe mit der längsten Spalte, nicht mit der Summe', () => {
    const viele = Array.from({ length: 6 }, (_, i) => schritt(i + 1, i + 1))
    const eine = layoutGraph(
      {
        reihenfolge: viele,
        phasen: [{ name: 'A', prompt_ids: viele.map((s) => s.prompt_id), ziel: '' }],
        abhaengigkeiten: [],
      },
      titel,
    )
    const zwei = layoutGraph(
      {
        reihenfolge: viele,
        phasen: [
          { name: 'A', prompt_ids: [1, 2, 3], ziel: '' },
          { name: 'B', prompt_ids: [4, 5, 6], ziel: '' },
        ],
        abhaengigkeiten: [],
      },
      titel,
    )
    expect(zwei.height).toBeLessThan(eine.height)
    expect(zwei.width).toBeGreaterThan(eine.width)
  })

  it('gibt auch für eine leere Analyse eine gültige Fläche zurück', () => {
    const g = layoutGraph({ reihenfolge: [], phasen: [], abhaengigkeiten: [] }, new Map())
    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
    expect(g.nodes).toEqual([])
  })
})

describe('umbrechen', () => {
  it('bricht an Wortgrenzen', () => {
    expect(umbrechen('eins zwei drei vier', 10, 2)).toEqual(['eins zwei', 'drei vier'])
  })

  it('kürzt, was nicht mehr passt, und sagt es mit einer Ellipse', () => {
    const zeilen = umbrechen('eins zwei drei vier fuenf sechs sieben', 10, 2)
    expect(zeilen).toHaveLength(2)
    expect(zeilen[1].endsWith('…')).toBe(true)
  })

  it('schneidet ein einzelnes zu langes Wort hart', () => {
    // Sonst bliebe die Zeile leer und der Titel verschwände ganz.
    const zeilen = umbrechen('Donaudampfschifffahrtsgesellschaft', 10, 1)
    expect(zeilen[0].length).toBeLessThanOrEqual(10)
    expect(zeilen[0].length).toBeGreaterThan(0)
  })

  it('kommt mit leer und nur Leerzeichen klar', () => {
    expect(umbrechen('', 10, 2)).toEqual([''])
    expect(umbrechen('   ', 10, 2)).toEqual([''])
  })

  it('hängt keine Ellipse an, was vollständig passt', () => {
    expect(umbrechen('kurz', 10, 2)).toEqual(['kurz'])
  })
})

/** Die x-Koordinate, an der ein SVG-Pfad endet. */
function endpunkt(d: string): number {
  const zahlen = d.match(/-?\d+(\.\d+)?/g) ?? []
  return Number(zahlen[zahlen.length - 2])
}
