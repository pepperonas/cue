// Collapsible sections of the mobile board.
//
// Two levels, same interaction model: a status section (Queued/Running/Done)
// contains project groups. Collapsed headers keep the identifying information
// visible — status/project name, its colour and the card count — so a folded
// board still reads as a summary instead of hiding information.
//
// Desktop renders `<Column>` from Board.tsx unchanged; these components are
// only mounted below the mobile breakpoint.
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useDroppable } from '@dnd-kit/core'
import { emphasized, prefersReducedMotion } from '../lib/motion'
import type { Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { Icon } from './ui'

/** Shared expand/collapse body with a height animation. */
function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = prefersReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : emphasized}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function StatusSection({
  status,
  count,
  open,
  onToggle,
  children,
}: {
  status: Status
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  // The whole section stays a drop target even while collapsed — dropping a
  // card on a folded section appends it there (Board expands it on hover).
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status } })
  return (
    <section ref={setNodeRef} className="column column--mobile" data-over={isOver}>
      <button
        className="column-head column-head--toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${status}`}
      >
        <Icon name="chevron_right" className={`sect-chevron ${open ? 'open' : ''}`} />
        <Icon name={STATUS_ICON[status]} className={`st-icon ${STATUS_CLASS[status]}`} />
        <span className="column-head-label">{STATUS_LABEL[status]}</span>
        <span className="count">{count}</span>
      </button>
      <Collapsible open={open}>
        <div className="column-list" id={`section-${status}`}>
          {children}
        </div>
      </Collapsible>
    </section>
  )
}

export function ProjectGroupSection({
  id,
  name,
  color,
  count,
  open,
  onToggle,
  children,
}: {
  id: string
  name: string
  color: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="pgroup" data-open={open}>
      <button
        className="pgroup-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`group-${id}`}
      >
        <Icon name="chevron_right" className={`sect-chevron ${open ? 'open' : ''}`} />
        <span className="pgroup-dot" style={{ background: color }} aria-hidden="true" />
        <span className="pgroup-name">{name}</span>
        <span className="count">{count}</span>
      </button>
      <Collapsible open={open}>
        <div className="pgroup-list" id={`group-${id}`}>
          {children}
        </div>
      </Collapsible>
    </div>
  )
}
