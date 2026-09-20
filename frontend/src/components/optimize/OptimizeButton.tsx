// Der Optimierungs-Indikator auf Karten, Listenzeilen und im Detailkopf.
//
// **Klick = ansehen, langes Drücken = die teure bzw. verändernde Aktion.**
// Bis 0.72.0 startete ein Klick auf den GELBEN Knopf eine neue Optimierung,
// während sein eigener Tooltip „zum Ansehen öffnen" versprach — er log über
// sich selbst, und ein Fehlklick kostete Geld.
//
// Vier Zustände, und nie Farbe allein: Zeichen und Beschriftung wechseln mit,
// damit der Knopf in Graustufen und für eine Sprachausgabe richtig bleibt.
// Die beiden grünen unterscheiden sich im ZEICHEN, nicht in der Farbe: dass
// der Prompt optimiert ist, ist dieselbe Aussage — woher, ist die andere.
import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../../lib/motion'
import { holdAction, optimizeState, tapAction } from '../../lib/optimization'
import type { Prompt } from '../../lib/types'
import { usePress } from '../../state/long-press'
import { useSetOptimizeManual } from '../../state/queries'
import { Icon } from '../ui'

/** Zeichen je Zustand — die nicht-farbige Hälfte des Signals. */
const ICON = {
  none: 'auto_awesome',
  pending: 'rate_review',
  applied: 'check_circle',
  manual: 'check',
} as const

export function OptimizeButton({
  prompt,
  busy,
  onOptimize,
  onOpen,
  variant = 'mini-btn',
}: {
  prompt: Prompt
  /** Für diesen Prompt läuft oder wartet eine Optimierung. */
  busy: boolean
  onOptimize: (prompt: Prompt) => void
  /** Den Prompt öffnen — dort liegen Vorschlag, Verlauf und „Erneut optimieren". */
  onOpen: (prompt: Prompt) => void
  variant?: 'mini-btn' | 'icon-btn'
}) {
  // ⚠️ Die Übersteuerung sitzt HIER und nicht als Prop: sie müsste sonst durch
  // Board, Spalte, Sektion und Listenzeile gefädelt werden, obwohl sie
  // ausschließlich zu diesem Knopf gehört. React Query entdoppelt die
  // Mutation über alle Vorkommen (dasselbe Muster wie der Modell-Badge).
  const setManual = useSetOptimizeManual()
  const reduce = prefersReducedMotion()
  const state = optimizeState(prompt)
  // Gemerkte Prompts bekommen die projekt-unabhängige Fassung (der Server
  // leitet den Modus aus derselben Markierung ab) — sagen, sonst sieht das
  // andere Ergebnis wie ein Fehler aus.
  const ziel = prompt.bookmarked ? 'universell optimieren' : 'mit KI optimieren'
  const hold = holdAction(prompt)

  const label = busy
    ? 'Optimierung läuft …'
    : state === 'pending'
      ? `Vorschlag v${prompt.optimization_version} wartet — öffnen; lange drücken: erneut ${ziel}`
      : state === 'applied'
        ? `Mit KI optimiert (v${prompt.optimization_version}) — öffnen; lange drücken: Markierung zurücknehmen`
        : state === 'manual'
          ? 'Von Hand als optimiert markiert — öffnen; lange drücken: Markierung entfernen'
          : `${prompt.bookmarked ? 'Bookmark universell optimieren' : 'Prompt mit KI optimieren'} — lange drücken: von Hand als optimiert markieren`

  // ⚠️ `usePress` übernimmt die Buchführung: genau eine der beiden Aktionen je
  // Druck, und der Klick nach einem ausgelösten Halten wird geschluckt. Das
  // ist die Stelle, an der man es sonst vergisst.
  const press = usePress({
    onTap: () => {
      if (busy) return
      if (tapAction(state) === 'open') onOpen(prompt)
      else onOptimize(prompt)
    },
    onHold: () => {
      if (busy) return
      if (hold.kind === 'optimize') onOptimize(prompt)
      else setManual.mutate({ id: prompt.id, value: hold.value })
    },
  })

  return (
    <button
      className={`${variant} optimize-btn ${busy ? 'is-busy' : ''}`}
      // Der Zustand steht am Element selbst, damit CSS, Tests und jeder, der
      // ins DOM sieht, dieselben Werte lesen, auf die der Code verzweigt.
      data-opt-state={busy ? 'busy' : state}
      aria-label={label}
      title={label}
      disabled={busy}
      {...press}
    >
      {busy ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <motion.span
          key={state}
          style={{ display: 'inline-flex' }}
          initial={reduce ? false : { scale: 0.4, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={reduce ? { duration: 0 } : springs.bouncy}
        >
          <Icon name={ICON[state]} />
        </motion.span>
      )}
    </button>
  )
}
