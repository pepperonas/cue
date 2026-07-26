// The ✨/✅ affordance on cards and list rows: queue an optimization, show a
// spinner while the runner works, and mark the prompt once a version exists.
// The button disables itself while busy, exactly like the spec asks.
import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../../lib/motion'
import type { Prompt } from '../../lib/types'
import { Icon } from '../ui'

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
  const label = busy
    ? 'Optimierung läuft …'
    : prompt.optimized
      ? `Optimiert (v${prompt.optimization_version}) — erneut optimieren`
      : 'Prompt mit KI optimieren'
  return (
    <button
      className={`${variant} optimize-btn ${prompt.optimized ? 'is-optimized' : ''} ${busy ? 'is-busy' : ''}`}
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
          key={prompt.optimized ? 'done' : 'idle'}
          style={{ display: 'inline-flex' }}
          initial={reduce ? false : { scale: 0.4, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={reduce ? { duration: 0 } : springs.bouncy}
        >
          <Icon name={prompt.optimized ? 'check_circle' : 'auto_awesome'} />
        </motion.span>
      )}
    </button>
  )
}
