import { describe, expect, it } from 'vitest'
import {
  buildExport,
  exportFilename,
  exportJson,
  parseMode,
  promptAnzahl,
  slugify,
  vorschlagVon,
} from './export'
import type { AiModel, Project, Prompt } from './types'

const UHR = new Date('2026-09-21T09:12:33.000Z')

function prompt(over: Partial<Prompt> = {}): Prompt {
  return {
    id: 417,
    title: 'Suche filtert die Projekt-Chips',
    body: 'Im Board verdeckt das Popup die Einträge darunter.',
    project_id: 3,
    status: 'queued',
    sort_order: 12,
    tags: 'search, gui',
    ai_model_id: 2,
    optimized_manually: null,
    bookmarked: false,
    bookmark_order: 0,
    tested: false,
    priority: 'high',
    test_closely: false,
    merged_from: 0,
    optimized: false,
    optimized_body: null,
    optimized_at: null,
    optimization_model: '',
    optimization_version: 3,
    blocked: false,
    created_at: '2026-09-14T08:00:00Z',
    updated_at: '2026-09-20T20:00:00Z',
    edited_at: '2026-09-20T19:00:00Z',
    ran_at: null,
    attachments: [],
    ...over,
  }
}

const PROJEKTE: Project[] = [
  { id: 3, name: 'cue', color: '#a78bfa', sort_order: 1 } as Project,
]
const MODELLE: AiModel[] = [
  { id: 2, name: 'Claude Opus 5' } as AiModel,
]
const KTX = { projekte: PROJEKTE, modelle: MODELLE, jetzt: UHR }

describe('buildExport', () => {
  it('trägt Fassung, Zeitpunkt und Anzahl', () => {
    const paket = buildExport([prompt(), prompt({ id: 418 })], KTX)
    expect(paket.cue_export).toBe(1)
    expect(paket.exported_at).toBe('2026-09-21T09:12:33.000Z')
    expect(paket.count).toBe(2)
    expect(paket.prompts).toHaveLength(2)
  })

  it('schickt das Projekt als NAMEN, nicht als Nummer', () => {
    // Eine `project_id` ist außerhalb dieser Instanz eine Zahl ohne Bedeutung.
    expect(buildExport([prompt()], KTX).prompts[0].project).toBe('cue')
  })

  it('lässt das Projekt weg, wenn der Prompt in keinem liegt', () => {
    const out = buildExport([prompt({ project_id: null })], KTX).prompts[0]
    expect('project' in out).toBe(false)
  })

  it('lässt das Projekt auch weg, wenn es die Liste nicht kennt', () => {
    // Zwischen Laden und Export gelöscht: lieber kein Feld als eine Nummer.
    const out = buildExport([prompt()], { ...KTX, projekte: [] }).prompts[0]
    expect('project' in out).toBe(false)
  })

  it('schickt das Modell im Klartext und lässt es sonst weg', () => {
    expect(buildExport([prompt()], KTX).prompts[0].model).toBe('Claude Opus 5')
    const ohne = buildExport([prompt({ ai_model_id: null })], KTX).prompts[0]
    expect('model' in ohne).toBe(false)
  })

  it('macht aus dem Tag-Zwischenspeicher eine Liste', () => {
    const out = buildExport([prompt({ tags: 'search, gui, Search' })], KTX).prompts[0]
    expect(out.tags).toEqual(['search', 'gui'])
  })

  it('nimmt KEINE internen Zähler mit', () => {
    // Eigenschaft statt Einzelfall: was die Verwaltung dieser App beschreibt,
    // hat in einer Datei, die woanders gelesen wird, nichts zu suchen.
    const out = buildExport([prompt()], KTX).prompts[0] as unknown as Record<string, unknown>
    for (const feld of [
      'id',
      'sort_order',
      'project_id',
      'ai_model_id',
      'bookmark_order',
      'bookmarked',
      'merged_from',
      'optimization_version',
      'optimization_model',
      'optimized',
      'optimized_manually',
      'updated_at',
      'blocked',
      'tested',
      'test_closely',
      'ran_at',
    ]) {
      expect(feld in out, feld).toBe(false)
    }
  })

  it('fällt für edited_at auf created_at zurück, wenn das Feld fehlt', () => {
    // Antwort aus einem Service-Worker-Cache von vor 0.41 — die Migration hat
    // serverseitig genau diesen Wert eingetragen, der Rückfall rät also nicht.
    const alt = prompt()
    delete (alt as Partial<Prompt>).edited_at
    expect(buildExport([alt], KTX).prompts[0].edited_at).toBe('2026-09-14T08:00:00Z')
  })
})

describe('die KI-Fassung reist nur, solange sie aussteht', () => {
  it('nimmt einen wartenden Vorschlag mit', () => {
    const out = buildExport(
      [prompt({ optimized: true, optimized_body: 'der Vorschlag' })],
      KTX,
    ).prompts[0]
    expect(out.optimized_body).toBe('der Vorschlag')
  })

  it('lässt eine entschiedene Fassung weg', () => {
    // `optimized: false` bei gesetztem Text heißt übernommen oder verworfen —
    // übernommen steht sie längst im `body`, verworfen ist sie Historie.
    const out = buildExport(
      [prompt({ optimized: false, optimized_body: 'längst entschieden' })],
      KTX,
    ).prompts[0]
    expect('optimized_body' in out).toBe(false)
  })

  it('lässt ein leeres Feld weg, auch wenn ein Vorschlag als wartend gilt', () => {
    const out = buildExport([prompt({ optimized: true, optimized_body: '   ' })], KTX).prompts[0]
    expect('optimized_body' in out).toBe(false)
  })

  it('vorschlagVon beantwortet dieselbe Frage einzeln', () => {
    expect(vorschlagVon({ optimized: true, optimized_body: 'x' })).toBe('x')
    expect(vorschlagVon({ optimized: false, optimized_body: 'x' })).toBeNull()
    expect(vorschlagVon({ optimized: true, optimized_body: null })).toBeNull()
  })
})

describe('Screenshots', () => {
  it('nennt die Namen, bettet aber nichts ein', () => {
    const out = buildExport(
      [
        prompt({
          attachments: [
            { id: 1, url: '/api/attachments/1', name: 'board.png', content_type: 'image/webp', size: 1 },
          ],
        }),
      ],
      KTX,
    ).prompts[0]
    expect(out.attachments).toEqual(['board.png'])
  })

  it('lässt das Feld weg, wenn es keine gibt', () => {
    expect('attachments' in buildExport([prompt()], KTX).prompts[0]).toBe(false)
  })
})

describe('exportJson', () => {
  it('ist eingerückt, endet auf einem Zeilenumbruch und liest sich zurück', () => {
    const text = exportJson([prompt()], KTX)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "cue_export": 1')
    expect(JSON.parse(text)).toEqual(buildExport([prompt()], KTX))
  })

  it('liefert für Datei und Zwischenablage dieselbe Zeichenkette', () => {
    // Es gibt nur diesen einen Bauer — die Zusicherung ist, dass niemand einen
    // zweiten danebenstellt.
    expect(exportJson([prompt()], KTX)).toBe(exportJson([prompt()], KTX))
  })
})

describe('exportFilename', () => {
  const tag = new Date(2026, 8, 21, 14, 0, 0)

  it('benennt einen einzelnen Prompt nach seinem Titel', () => {
    expect(exportFilename([prompt()], tag)).toBe('cue-suche-filtert-die-projekt-chips-20260921.json')
  })

  it('zählt bei mehreren', () => {
    expect(exportFilename([prompt(), prompt(), prompt()], tag)).toBe('cue-3-prompts-20260921.json')
  })

  it('bleibt bei einem titellosen Prompt ein gültiger Name', () => {
    expect(exportFilename([prompt({ title: '   ' })], tag)).toBe('cue-prompt-20260921.json')
  })

  it('nimmt die ÖRTLICHE Zeit, nicht UTC', () => {
    // Um 00:30 in Berlin ist es nach UTC noch der Vortag; der Dateiname gehört
    // dem Menschen, der ihn liest. Der Doppelgänger unten trennt beide
    // Auslegungen unabhängig von der Zeitzone des Testläufers.
    const doppelgaenger = {
      getFullYear: () => 2026,
      getMonth: () => 8,
      getDate: () => 21,
      toISOString: () => '2026-09-20T22:30:00.000Z',
    } as unknown as Date
    expect(exportFilename([prompt()], doppelgaenger)).toContain('-20260921.json')
  })
})

describe('slugify', () => {
  it('schreibt Umlaute um, statt sie wegzuwerfen', () => {
    expect(slugify('Für den Alltag')).toBe('fuer-den-alltag')
    expect(slugify('Größe ändern')).toBe('groesse-aendern')
    expect(slugify('Straße')).toBe('strasse')
  })

  it('entfernt übriges Diakritisches', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme')
  })

  it('endet nie auf einem Bindestrich — auch nicht nach dem Schnitt', () => {
    const lang = slugify('a'.repeat(47) + ' b')
    expect(lang.endsWith('-')).toBe(false)
    expect(lang.length).toBeLessThanOrEqual(48)
  })

  it('ergibt für reine Sonderzeichen den leeren Text', () => {
    expect(slugify('### ---')).toBe('')
  })
})

describe('parseMode', () => {
  it('nimmt die Zwischenablage nur, wenn genau das gespeichert ist', () => {
    expect(parseMode('zwischenablage')).toBe('zwischenablage')
  })

  it('macht aus allem Unbekannten die Datei', () => {
    // Ein kaputter Eintrag darf nicht in einem Zustand landen, den niemand
    // gewählt hat.
    for (const raw of [null, undefined, '', 'datei', 'ZWISCHENABLAGE', '{"x":1}']) {
      expect(parseMode(raw), String(raw)).toBe('datei')
    }
  })
})

describe('promptAnzahl', () => {
  it('unterscheidet Einzahl und Mehrzahl', () => {
    expect(promptAnzahl(1)).toBe('1 Prompt')
    expect(promptAnzahl(2)).toBe('2 Prompts')
    expect(promptAnzahl(0)).toBe('0 Prompts')
  })
})
