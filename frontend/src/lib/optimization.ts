// Pure rules of the optimization feature — the panel only renders them.
import type { Optimization, Prompt } from './types'

/**
 * The three states the ✨-button communicates, as one explicit value.
 *
 * Derived once, here, instead of re-deriving `prompt.optimized` and
 * `optimization_applied_at` at each call site — the two conditions can hold at
 * the same time (a prompt that was optimized last week and has a fresh
 * proposal waiting), and the answer to that has to be the same everywhere.
 *
 * **Rank: `pending` beats `applied`.** The pending state is the one that asks
 * something of the user; "wurde schon einmal optimiert" is only history and
 * stays readable in the panel either way. Showing the green "done" tint over an
 * undecided proposal would hide the request for a decision.
 */
export type OptimizeState = 'none' | 'pending' | 'applied' | 'manual'

/**
 * ⚠️ Nur `optimized` ist Pflicht. Eine Antwort, die der Service Worker vor
 * diesem Feld zwischengespeichert hat, trägt es nicht — und `undefined` muss
 * sich wie `null` verhalten („kein Eingriff"), nicht wie `false`. Genau
 * deshalb prüft `optimizeState` unten auf `=== false` bzw. `=== true` und
 * nicht auf Wahrheitswerte.
 */
type Zustandsquelle = Pick<Prompt, 'optimized'> &
  Partial<Pick<Prompt, 'optimization_applied_at' | 'optimized_manually'>>

/**
 * ⚠️ Vier Zustände seit 0.72.0, und die REIHENFOLGE der Prüfungen ist die
 * Aussage:
 *
 *   1. `pending` schlägt alles — es ist der einzige Zustand, der etwas vom
 *      Nutzer will.
 *   2. Ein ausdrücklicher Einwand (`optimized_manually === false`) schlägt die
 *      KI-Tatsache. Genau dafür ist das Feld dreiwertig: „zurückgenommen" muss
 *      sich sagen lassen, ohne `optimization_applied_at` zu löschen — das ist
 *      Historie und keine Meinung.
 *   3. Die KI-Tatsache.
 *   4. Die Markierung von Hand.
 */
export function optimizeState(prompt: Zustandsquelle): OptimizeState {
  if (prompt.optimized) return 'pending'
  if (prompt.optimized_manually === false) return 'none'
  if (prompt.optimization_applied_at) return 'applied'
  if (prompt.optimized_manually === true) return 'manual'
  return 'none'
}

/** Was ein Klick auf den Knopf tut. */
export type TapAction = 'open' | 'optimize'

/**
 * Klick = ansehen, außer es gibt noch nichts anzusehen.
 *
 * ⚠️ Auf `pending` hat der Klick bis 0.72.0 eine NEUE Optimierung gestartet,
 * obwohl sein eigener Tooltip „zum Ansehen öffnen" versprach — der Knopf log
 * über sich selbst, und ein versehentlicher Klick kostete Geld. Jetzt gilt
 * durchgehend: was schon einen Zustand hat, wird geöffnet; nur der leere
 * Knopf stößt an.
 */
export function tapAction(state: OptimizeState): TapAction {
  return state === 'none' ? 'optimize' : 'open'
}

/** Was ein langer Druck tut. */
export type HoldAction =
  | { kind: 'optimize' }
  | { kind: 'manual'; value: boolean | null }

/**
 * Langes Drücken: die teure bzw. verändernde Aktion.
 *
 * Auf `pending` heißt das „erneut optimieren" — dort liegt ein Vorschlag, den
 * man verwerfen und neu rechnen lassen will. Überall sonst schaltet es die
 * Markierung, und zwar IMMER umkehrbar:
 *
 *   ✨ nichts        → von Hand markiert  (true)
 *   ✓  von Hand      → nichts            (null)
 *   ✓○ von der KI    → zurückgenommen    (false)
 *   ✨ zurückgenommen → wieder die KI     (null)
 *
 * Erneut optimieren bei Grün führt bewusst über den Dialog („Erneut
 * optimieren" steht dort schon): eine Geste, eine Bedeutung.
 */
export function holdAction(prompt: Zustandsquelle): HoldAction {
  const state = optimizeState(prompt)
  if (state === 'pending') return { kind: 'optimize' }
  if (state === 'applied') return { kind: 'manual', value: false }
  if (state === 'manual') return { kind: 'manual', value: null }
  // `none` hat zwei Herkünfte: gar nichts — oder ein früherer Einwand, den
  // dieser Druck wieder aufhebt.
  return { kind: 'manual', value: prompt.optimized_manually === false ? null : true }
}

/**
 * Whether a prompt may be optimized at all.
 *
 * Optimizing is PREPARATION — it rewrites the text you are about to send. Once
 * a prompt is running or done that text has already been used, so offering the
 * rewrite there costs money for a result nobody will send; failed and archived
 * prompts are out for the same reason, and moving one back to the queue makes
 * it eligible again. The server enforces the same rule in
 * `optimization/service.py:_queue_for`, so hiding the button is a courtesy,
 * not the guard.
 */
export function isOptimizable(prompt: Pick<Prompt, 'status'>): boolean {
  return prompt.status === 'queued'
}

/**
 * The versions worth showing: a job that failed or was canceled produced no
 * text, so it is history, not a version. Shared by the panel and the pinned
 * decision bar so both look at exactly the same list.
 */
export function succeededVersions(history: Optimization[] | undefined): Optimization[] {
  return (history ?? []).filter((row) => row.status === 'succeeded')
}

/**
 * The proposal awaiting a decision, or null.
 *
 * Two conditions, and the first one is the important one: `prompt.optimized`
 * means "a result is currently held open for review". Without that guard an
 * undecided row further back in the history (a job that finished while the
 * prompt was already decided elsewhere, a restored backup) would raise a
 * decision bar for a version that is NOT what the prompt is offering — and
 * applying it would overwrite the text with something the user never saw in
 * the diff above the buttons.
 */
export function pendingProposal(
  prompt: Pick<Prompt, 'optimized'>,
  versions: Optimization[],
): Optimization | null {
  if (!prompt.optimized) return null
  return versions.find((row) => row.decision === 'pending') ?? null
}

/** One side-by-side change an optimization proposes beside the body. */
export interface MetaChange {
  key: 'title' | 'tags'
  label: string
  from: string
  to: string
}

/**
 * Title and tag changes an attempt proposes — for the review.
 *
 * ⚠️ This mirrors the APPLY rule on the server, and it has to: a change shown
 * here but not written would be a lie, and one written but not shown would be
 * a silent edit of something the user chose by hand. The server applies a
 * proposal when it is non-empty; an identical value is left out here only
 * because applying it changes nothing there is to see.
 *
 * An EMPTY proposal is not a change — "the model proposed nothing" and "remove
 * everything" look the same on the wire, and only one of those readings is
 * lossless (the server takes the same view).
 */
export function metaChanges(attempt: Optimization | undefined): MetaChange[] {
  if (!attempt) return []
  const out: MetaChange[] = []
  const push = (key: MetaChange['key'], label: string, from: string, to: string | null) => {
    const next = (to ?? '').trim()
    if (!next || next === (from ?? '').trim()) return
    out.push({ key, label, from: (from ?? '').trim(), to: next })
  }
  push('title', 'Titel', attempt.original_title, attempt.optimized_title)
  push('tags', 'Tags', attempt.original_tags, attempt.optimized_tags)
  return out
}
