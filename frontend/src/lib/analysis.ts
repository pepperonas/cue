// Reine Regeln der Projekt-Analyse: was der Vorschlag bedeutet und wie der
// Ablaufplan aussieht. Kein React, kein DOM — deshalb ohne Browser prüfbar.
import { priorityRank } from './order'
import type { Priority, Prompt } from './types'

export interface AnalysisStep {
  prompt_id: number
  rang: number
  begruendung: string
  prioritaet: Priority | null
  ergaenzt: boolean
}
export interface AnalysisBundle {
  prompt_ids: number[]
  titel: string
  begruendung: string
}
export interface AnalysisRedundancy {
  prompt_id: number
  grund: string
  abgedeckt_von: number | null
}
export interface AnalysisPhase {
  name: string
  prompt_ids: number[]
  ziel: string
}
export interface AnalysisEdge {
  von: number
  nach: number
  grund: string
}
export interface AnalysisResult {
  reihenfolge: AnalysisStep[]
  zusammenfuehren: AnalysisBundle[]
  redundant: AnalysisRedundancy[]
  phasen: AnalysisPhase[]
  abhaengigkeiten: AnalysisEdge[]
  zusammenfassung: string
  hinweise: string[]
}
export type AnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export interface Analysis {
  id: number
  project_id: number | null
  project_name: string
  status: AnalysisStatus
  decision: 'pending' | 'applied' | 'discarded' | 'superseded'
  provider: string
  model: string
  prompt_version: number
  prompt_count: number
  stale: boolean
  duration_ms: number | null
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
  result: AnalysisResult | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  decided_at: string | null
}

export const ACTIVE: AnalysisStatus[] = ['queued', 'running']

export function istAktiv(a: Pick<Analysis, 'status'>): boolean {
  return ACTIVE.includes(a.status)
}

/** Ein fertiger Vorschlag, über den noch nicht entschieden wurde. */
export function wartetAufEntscheidung(a: Analysis): boolean {
  return a.status === 'succeeded' && a.decision === 'pending' && a.result !== null
}

/**
 * Was das Board nach dem Übernehmen WIRKLICH zeigen wird.
 *
 * ⚠️ Der Vorschlag ist eine flache Folge, die Queue ist nach Priorität
 * gebändert (`columnComparator`). Schlägt die KI „X zuerst" vor, X aber steht
 * auf „niedrig", steht jeder „hohe" Prompt weiterhin darüber. Diese Funktion
 * rechnet das Ergebnis mit DERSELBEN Regel aus, die das Board benutzt — die
 * Ansicht zeigt damit die Wahrheit statt einer Absicht.
 */
export function boardFolge(steps: AnalysisStep[], prompts: Map<number, Prompt>): number[] {
  return steps
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => prompts.has(s.prompt_id))
    .sort((a, b) => {
      const pa = { status: 'queued' as const, priority: prioritaetNach(a.s, prompts) }
      const pb = { status: 'queued' as const, priority: prioritaetNach(b.s, prompts) }
      return priorityRank(pa) - priorityRank(pb) || a.index - b.index
    })
    .map(({ s }) => s.prompt_id)
}

function prioritaetNach(step: AnalysisStep, prompts: Map<number, Prompt>): Priority {
  return step.prioritaet ?? prompts.get(step.prompt_id)?.priority ?? 'normal'
}

/**
 * Wie viele Prompts landen NICHT dort, wo der Vorschlag sie hinstellt?
 *
 * Null heißt: die vorgeschlagene Folge ist genau die, die danach im Board
 * steht. Alles darüber ist ein Hinweis wert, sonst wirkt die Übernahme kaputt.
 */
export function abweichungen(steps: AnalysisStep[], prompts: Map<number, Prompt>): number {
  const gewuenscht = steps.filter((s) => prompts.has(s.prompt_id)).map((s) => s.prompt_id)
  const echt = boardFolge(steps, prompts)
  return gewuenscht.reduce((summe, id, i) => summe + (echt[i] === id ? 0 : 1), 0)
}

/** Prompts, deren Priorität der Vorschlag ändern würde. */
export function prioritaetsAenderungen(steps: AnalysisStep[]): AnalysisStep[] {
  return steps.filter((s) => s.prioritaet !== null)
}

// ---------------------------------------------------------------- Ablaufplan

export interface GraphNode {
  id: number
  label: string
  rang: number
  x: number
  y: number
  w: number
  h: number
  /** Spaltenindex = Phase. */
  phase: number
}
export interface GraphEdge {
  von: number
  nach: number
  grund: string
  d: string
}
export interface GraphPhase {
  name: string
  ziel: string
  x: number
  w: number
}
export interface Graph {
  width: number
  height: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  phasen: GraphPhase[]
}

export const NODE_W = 188
export const NODE_H = 54
export const SPALTE_GAP = 56
export const ZEILE_GAP = 16
export const KOPF_H = 44
const RAND = 12

/**
 * Den Ablaufplan berechnen: Phasen als Spalten (links → rechts = zeitlich),
 * Schritte darin gestapelt, Abhängigkeiten als Kurven.
 *
 * Spalten statt Zeilen, weil „zuerst das, dann das" von links nach rechts
 * gelesen wird und die Karten damit eine feste Breite behalten — bei Zeilen
 * müsste jede Phase umbrechen und die Pfeile liefen kreuz und quer.
 *
 * Ohne Phasen wird EINE Spalte gebildet: eine Grafik, die bei fehlender
 * Gliederung gar nicht erscheint, wäre für den Nutzer ein Fehler, nicht eine
 * fehlende Angabe der KI.
 */
export function layoutGraph(
  result: Pick<AnalysisResult, 'phasen' | 'abhaengigkeiten' | 'reihenfolge'>,
  titel: Map<number, string>,
): Graph {
  const rang = new Map(result.reihenfolge.map((s) => [s.prompt_id, s.rang]))
  const bekannt = new Set(result.reihenfolge.map((s) => s.prompt_id))
  const spalten: { name: string; ziel: string; ids: number[] }[] =
    result.phasen.length > 0
      ? result.phasen.map((p) => ({
          name: p.name,
          ziel: p.ziel,
          ids: p.prompt_ids.filter((id) => bekannt.has(id)),
        }))
      : [{ name: 'Ablauf', ziel: '', ids: result.reihenfolge.map((s) => s.prompt_id) }]

  const gefuellt = spalten.filter((s) => s.ids.length > 0)
  const nodes: GraphNode[] = []
  const phasen: GraphPhase[] = []
  gefuellt.forEach((spalte, i) => {
    const x = RAND + i * (NODE_W + SPALTE_GAP)
    phasen.push({ name: spalte.name, ziel: spalte.ziel, x, w: NODE_W })
    spalte.ids.forEach((id, j) => {
      nodes.push({
        id,
        label: titel.get(id) ?? `#${id}`,
        rang: rang.get(id) ?? 0,
        x,
        y: RAND + KOPF_H + j * (NODE_H + ZEILE_GAP),
        w: NODE_W,
        h: NODE_H,
        phase: i,
      })
    })
  })

  const nachId = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = []
  for (const kante of result.abhaengigkeiten) {
    const a = nachId.get(kante.von)
    const b = nachId.get(kante.nach)
    if (!a || !b) continue
    edges.push({ von: kante.von, nach: kante.nach, grund: kante.grund, d: pfad(a, b) })
  }

  const hoechste = gefuellt.reduce((m, s) => Math.max(m, s.ids.length), 0)
  return {
    width: RAND * 2 + Math.max(1, gefuellt.length) * NODE_W + Math.max(0, gefuellt.length - 1) * SPALTE_GAP,
    height: RAND * 2 + KOPF_H + Math.max(1, hoechste) * NODE_H + Math.max(0, hoechste - 1) * ZEILE_GAP,
    nodes,
    edges,
    phasen,
  }
}

/** Kurve von der rechten Kante der Quelle zur linken Kante des Ziels. */
function pfad(a: GraphNode, b: GraphNode): string {
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = b.y + b.h / 2
  if (b.phase === a.phase) {
    // Gleiche Spalte: außen herum, sonst liefe die Linie durch die Karten.
    const bogen = a.x + a.w + SPALTE_GAP / 2
    return `M ${x1} ${y1} C ${bogen} ${y1}, ${bogen} ${y2}, ${x2 + b.w} ${y2}`
  }
  const mitte = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mitte} ${y1}, ${mitte} ${y2}, ${x2} ${y2}`
}

/**
 * Ein Kartentitel auf feste Zeilen umgebrochen.
 *
 * SVG-`<text>` bricht NICHT um — der Titel muss hier zerlegt werden, sonst
 * läuft er über die Karte hinaus und über die Nachbarn. Rein und getestet,
 * weil eine falsche Grenze still zu abgeschnittenen Wörtern führt.
 */
export function umbrechen(text: string, proZeile: number, zeilen: number): string[] {
  const woerter = (text || '').trim().split(/\s+/).filter(Boolean)
  if (woerter.length === 0) return ['']
  const raus: string[] = []
  let aktuell = ''
  for (const wort of woerter) {
    const kandidat = aktuell ? `${aktuell} ${wort}` : wort
    if (kandidat.length <= proZeile) {
      aktuell = kandidat
      continue
    }
    if (aktuell) raus.push(aktuell)
    if (raus.length === zeilen) break
    // Ein einzelnes Wort, das allein zu lang ist, wird hart geschnitten —
    // sonst bliebe die Zeile leer und der Titel verschwände.
    aktuell = wort.length > proZeile ? wort.slice(0, proZeile) : wort
  }
  if (aktuell && raus.length < zeilen) raus.push(aktuell)
  const sichtbar = raus.slice(0, zeilen)
  const passtNicht = raus.length > zeilen || woerter.join(' ').length > sichtbar.join(' ').length
  if (passtNicht && sichtbar.length > 0) {
    const letzte = sichtbar[sichtbar.length - 1]
    sichtbar[sichtbar.length - 1] =
      letzte.length >= proZeile ? `${letzte.slice(0, Math.max(0, proZeile - 1))}…` : `${letzte}…`
  }
  return sichtbar
}
