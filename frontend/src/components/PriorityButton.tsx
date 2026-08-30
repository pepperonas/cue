import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../lib/motion'
import { PRIORITY_ICON, PRIORITY_LABEL, type Priority } from '../lib/types'
import { nextPriority } from '../lib/order'
import { Icon } from './ui'

interface Props {
  priority: Priority
  onChange: (next: Priority) => void
  variant?: 'mini-btn' | 'icon-btn'
}

/**
 * Three-state priority toggle for cards and list rows.
 *
 * A cycle rather than a menu: on a card the control has to fit next to five
 * others, and a popover for three values costs two interactions where one
 * does. The detail sheet offers the same three as a real dropdown, which is
 * where picking a specific level directly belongs.
 */
export function PriorityButton({ priority, onChange, variant = 'mini-btn' }: Props) {
  const reduce = prefersReducedMotion()
  const next = nextPriority(priority)
  // Says what it IS and what the click will do — a cycle whose next step is a
  // guess is worse than a menu.
  const label = `Priorität: ${PRIORITY_LABEL[priority]} — klicken für ${PRIORITY_LABEL[next]}`
  return (
    <button
      className={`${variant} prio-btn`}
      data-prio={priority}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onChange(next)
      }}
    >
      <motion.span
        // Remount per level so the change is visible, not just different.
        key={priority}
        style={{ display: 'inline-flex' }}
        initial={reduce ? false : { scale: 0.3, y: priority === 'high' ? 6 : -6 }}
        animate={{ scale: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : springs.bouncy}
      >
        <Icon name={PRIORITY_ICON[priority]} />
      </motion.span>
    </button>
  )
}

/** The same three levels as a real dropdown — for the detail sheet. */
export function PrioritySelect({
  priority,
  onChange,
  id,
}: {
  priority: Priority
  onChange: (next: Priority) => void
  id?: string
}) {
  return (
    <select
      id={id}
      className="select select--prio"
      data-prio={priority}
      value={priority}
      aria-label="Priorität"
      onChange={(e) => onChange(e.target.value as Priority)}
    >
      {/* Urgent first: the list reads top-down like the queue it orders. */}
      <option value="high">Hoch</option>
      <option value="normal">Mittel</option>
      <option value="low">Gering</option>
    </select>
  )
}
