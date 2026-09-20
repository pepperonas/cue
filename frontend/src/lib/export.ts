/**
 * Prompts als JSON hinausgeben — eine Regel, zwei Ziele.
 *
 * Datei und Zwischenablage bauen dieselbe Zeichenkette. Zwei Wege wären zwei
 * Antworten auf dieselbe Frage, und die eine, die seltener benutzt wird, driftet
 * ab. Deshalb liegt hier alles Inhaltliche und die Komponente reicht es nur
 * durch.
 *
 * ⚠️ Exportiert wird eine PORTABLE Sicht, nicht der Datensatz. Das Projekt
 * reist als NAME (eine `project_id` ist außerhalb dieser Instanz eine Zahl ohne
 * Bedeutung), das Modell als Klartext, und die internen Zähler (`sort_order`,
 * `bookmark_order`, `optimization_version`, `merged_from`) bleiben draußen —
 * sie beschreiben die Verwaltung dieser App, nicht den Prompt. Ein vollständiges
 * Abbild gibt es schon: `/api/export` sichert Projekte + Prompts am Stück.
 *
 * ⚠️ Was es nicht gibt, bekommt auch kein Feld. Ein `"project": null` behauptet
 * eine leere Zuordnung, wo schlicht keine getroffen wurde.
 */
import type { AiModel, Priority, Project, Prompt, Status } from './types'
import { dedupeTags } from './tags'

/** Fassung des Formats. Ein Leser kann daran erkennen, was ihn erwartet. */
export const EXPORT_VERSION = 1

/** Höchstlänge des Titel-Anteils im Dateinamen. */
export const SLUG_MAX = 48

/** Wo die gewählte Ausgabe liegt. */
export const EXPORT_MODE_KEY = 'cue-export-mode'

export type ExportZiel = 'datei' | 'zwischenablage'

/** Ein Prompt, wie er die App verlässt. */
export interface ExportierterPrompt {
  title: string
  body: string
  tags: string[]
  /** Nur wenn der Prompt in einem Projekt liegt. */
  project?: string
  status: Status
  priority: Priority
  /** Nur wenn ein Modell zugeordnet ist. */
  model?: string
  created_at: string
  edited_at: string
  /** Nur solange ein KI-Vorschlag unentschieden wartet — s. `vorschlagVon`. */
  optimized_body?: string
  /** Nur die NAMEN vorhandener Screenshots, s. unten. */
  attachments?: string[]
}

export interface ExportPaket {
  cue_export: number
  exported_at: string
  count: number
  prompts: ExportierterPrompt[]
}

export interface ExportKontext {
  projekte?: Project[]
  modelle?: AiModel[]
  /** Injizierbare Uhr — die Tests dürfen nicht von der Wanduhr abhängen. */
  jetzt?: Date
}

/**
 * Der wartende Vorschlag, oder nichts.
 *
 * ⚠️ `prompt.optimized` ist die Bedingung, nicht `optimized_body`: eine
 * übernommene Optimierung steht längst im `body`, eine verworfene ist Historie.
 * Nur solange die Entscheidung aussteht, ist `body` NICHT der neueste Text —
 * und nur dann gehören zwei Texte in eine Datei, in der man sie sonst nicht
 * auseinanderhalten könnte.
 */
export function vorschlagVon(prompt: Pick<Prompt, 'optimized' | 'optimized_body'>): string | null {
  if (!prompt.optimized) return null
  const text = (prompt.optimized_body ?? '').trim()
  return text ? prompt.optimized_body! : null
}

function namen<T extends { id: number; name: string }>(rows: T[] | undefined): Map<number, string> {
  return new Map((rows ?? []).map((r) => [r.id, r.name]))
}

/** Ein Prompt in die portable Form bringen. */
export function exportPrompt(
  prompt: Prompt,
  projekte: Map<number, string>,
  modelle: Map<number, string>,
): ExportierterPrompt {
  const projekt = prompt.project_id == null ? undefined : projekte.get(prompt.project_id)
  const modell = prompt.ai_model_id == null ? undefined : modelle.get(prompt.ai_model_id)
  const vorschlag = vorschlagVon(prompt)
  // ⚠️ Nur die Dateinamen. Ein Screenshot ist eine Binärdatei; base64 in einer
  // Datei, die man lesen können soll, wäre unbrauchbar — ihn wegzulassen, ohne
  // es zu sagen, wäre gelogen. So weiß der Empfänger, dass es Bilder gibt.
  const anhaenge = (prompt.attachments ?? []).map((a) => a.name).filter(Boolean)
  return {
    title: prompt.title,
    body: prompt.body,
    tags: dedupeTags(prompt.tags),
    ...(projekt ? { project: projekt } : {}),
    status: prompt.status,
    priority: prompt.priority,
    ...(modell ? { model: modell } : {}),
    created_at: prompt.created_at,
    // ⚠️ Der Rückfall ist keine Schätzung: die Migration hat `edited_at` genau
    // mit `created_at` vorbelegt. Fehlt es, stammt die Antwort aus einem
    // Service-Worker-Cache von vor 0.41 — der Rückfall sagt dasselbe wie der
    // Server.
    edited_at: prompt.edited_at ?? prompt.created_at,
    ...(vorschlag ? { optimized_body: vorschlag } : {}),
    ...(anhaenge.length ? { attachments: anhaenge } : {}),
  }
}

/** Das Paket, das geschrieben oder kopiert wird. */
export function buildExport(prompts: Prompt[], ctx: ExportKontext = {}): ExportPaket {
  const projekte = namen(ctx.projekte)
  const modelle = namen(ctx.modelle)
  return {
    cue_export: EXPORT_VERSION,
    exported_at: (ctx.jetzt ?? new Date()).toISOString(),
    count: prompts.length,
    prompts: prompts.map((p) => exportPrompt(p, projekte, modelle)),
  }
}

/** Dieselbe Zeichenkette für Datei und Zwischenablage. */
export function exportJson(prompts: Prompt[], ctx: ExportKontext = {}): string {
  return `${JSON.stringify(buildExport(prompts, ctx), null, 2)}\n`
}

const UMLAUTE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss',
}

/**
 * Titel → Dateinamen-Anteil.
 *
 * ⚠️ Umlaute werden UMSCHRIEBEN, nicht weggeworfen: „Für den Alltag" ergäbe
 * sonst `f-r-den-alltag`. Alles übrige Diakritische fällt per NFD weg (é → e).
 */
export function slugify(text: string): string {
  return (text ?? '')
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTE[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    // ⚠️ Der Schnitt kann mitten in einem Trenner landen; ein Dateiname endet
    // nicht auf einem Bindestrich.
    .replace(/-+$/, '')
}

/**
 * Wie die Datei heißt.
 *
 * ⚠️ Das Datum kommt aus der ÖRTLICHEN Zeit, nicht aus `toISOString()`: um
 * 01:00 in Berlin ist es nach UTC noch der Vortag, und der Dateiname gehört dem
 * Menschen, der ihn liest.
 */
export function exportFilename(prompts: Prompt[], jetzt: Date = new Date()): string {
  const d = `${jetzt.getFullYear()}${String(jetzt.getMonth() + 1).padStart(2, '0')}${String(
    jetzt.getDate(),
  ).padStart(2, '0')}`
  if (prompts.length === 1) return `cue-${slugify(prompts[0].title) || 'prompt'}-${d}.json`
  if (prompts.length === 0) return `cue-prompts-${d}.json`
  return `cue-${prompts.length}-prompts-${d}.json`
}

/**
 * Das gespeicherte Ziel lesen.
 *
 * Alles Unbekannte wird zur Datei: ein kaputter Eintrag darf den Export nicht
 * in einen Zustand bringen, den niemand gewählt hat.
 */
export function parseMode(raw: string | null | undefined): ExportZiel {
  return raw === 'zwischenablage' ? 'zwischenablage' : 'datei'
}

/** „1 Prompt" / „3 Prompts" — für Beschriftung und Rückmeldung. */
export function promptAnzahl(n: number): string {
  return n === 1 ? '1 Prompt' : `${n} Prompts`
}
