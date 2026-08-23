// The ✨/⟳/✅ affordance on cards and list rows: queue an optimization, show a
// spinner while the runner works, and say afterwards what came of it.
//
// Three states, one per colour — and never colour alone: the glyph and the
// accessible name change with it, so the button still reads correctly in
// greyscale, for a screen reader and for anyone who cannot tell the two tints
// apart.
import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../../lib/motion'
import { optimizeState } from '../../lib/optimization'
import type { Prompt } from '../../lib/types'
import { Icon } from '../ui'

/** Glyph per state — the non-colour half of the signal. */
const ICON = {
  none: 'auto_awesome',
  pending: 'rate_review',
  applied: 'check_circle',
} as const

export function OptimizeButton({
  prompt,
  busy,
  onOptimize,
  variant = 'mini-btn',
}: {
  prompt: Prompt
  /** An optimization for this prompt is queued or running. */
  busy: boolean
  onOptimize: (prompt: Prompt) => void
  variant?: 'mini-btn' | 'icon-btn'
}) {
  const reduce = prefersReducedMotion()
  const state = optimizeState(prompt)
  // Bookmarked prompts get the project-agnostic rewrite (the server derives the
  // mode from the same flag) — say so, otherwise the different result looks
  // like a glitch.
  const goal = prompt.bookmarked ? 'universell optimieren' : 'mit KI optimieren'
  const label = busy
    ? 'Optimierung läuft …'
    : state === 'pending'
      ? `Optimierung v${prompt.optimization_version} wartet auf Übernahme — zum Ansehen öffnen`
      : state === 'applied'
        ? `Mit KI optimiert (v${prompt.optimization_version}) — erneut ${goal}`
        : prompt.bookmarked
          ? 'Bookmark universell optimieren (für jedes Projekt einsetzbar)'
          : 'Prompt mit KI optimieren'
  return (
    <button
      className={`${variant} optimize-btn ${busy ? 'is-busy' : ''}`}
      // The state is on the element itself, so CSS, tests and anyone reading the
      // DOM see the same three values the code branches on.
      data-opt-state={busy ? 'busy' : state}
      aria-label={label}
      title={label}
      disabled={busy}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (!busy) onOptimize(prompt)
      }}
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
