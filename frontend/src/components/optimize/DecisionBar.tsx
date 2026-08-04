// The decision on a finished optimization proposal: take it over, or drop it.
//
// It lives OUTSIDE the detail sheet's scroll region on purpose. It used to sit
// under the diff inside the panel, which meant the one action the sheet was
// opened for was pushed below a 400 px diff — off-screen, with no way to scroll
// to it (the panel was in the sheet's pinned region and simply got clipped).
// Pinned to the bottom, "Übernehmen" is reachable from anywhere in the diff.
import { motion } from 'motion/react'
import { springs } from '../../lib/motion'
import { IS_MAC } from '../../lib/platform'
import type { Optimization } from '../../lib/types'
import { Icon } from '../ui'

export function DecisionBar({
  proposal,
  busy,
  onApply,
  onDiscard,
}: {
  proposal: Optimization
  busy: boolean
  onApply: () => void
  onDiscard: () => void
}) {
  return (
    <motion.div
      className="opt-decide"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.spatialFast}
    >
      <p className="opt-decide-text">
        <Icon name="rule" />
        <span>
          <b>Vorschlag v{proposal.version}</b>
          <span className="opt-decide-note">
            {' '}
            — dein Prompt bleibt unverändert, bis du übernimmst.
          </span>
        </span>
      </p>
      <div className="opt-decide-actions">
        <button className="btn btn--text" disabled={busy} onClick={onDiscard}>
          <Icon name="close" /> Verwerfen
        </button>
        <button className="btn btn--filled" disabled={busy} onClick={onApply}>
          <Icon name="check" /> Übernehmen <kbd>{IS_MAC ? '⌘↵' : 'Strg ↵'}</kbd>
        </button>
      </div>
    </motion.div>
  )
}
