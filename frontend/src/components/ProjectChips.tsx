import { useState } from 'react'
import type { Project } from '../lib/types'
import { useMediaQuery } from '../lib/media'
import { Icon } from './ui'

type Filter = number | 'all' | 'none'

/** Open prompts (queued + running) per project; 'none' = prompts without one. */
export type OpenCounts = Map<number | 'none', number>

interface ChipProps {
  p: Project
  active: boolean
  count: number
  onClick: () => void
}

/** Badge with the number of open prompts. Zero is not rendered at all. */
function OpenBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="chip-count" title={`${count} offen (Queued + Running)`}>
      {count}
    </span>
  )
}

function ProjectChip({ p, active, count, onClick }: ChipProps) {
  return (
    <button className="chip" data-active={active} onClick={onClick}>
      <span className="dot" style={{ background: p.color }} />
      {p.name}
      <OpenBadge count={count} />
    </button>
  )
}

/** The project filter chips. "Alle" and "Ohne Projekt" stay fixed at the front.
 *
 * The order is DERIVED (`sortProjectsByAttention` in App): projects with open
 * prompts first, most open first, the user's manual order as the tiebreak and
 * for everything with an empty queue.
 *
 * These chips used to be drag-sortable themselves. They no longer are, because
 * a derived order makes that gesture a lie: the drop writes a new
 * `sort_order`, the count rule immediately re-sorts on top of it, and the chip
 * visibly snaps back. The manual order is set where it is actually visible —
 * the Projekte tab, which is not count-sorted. */
export function ProjectChips({
  projects,
  filter,
  setFilter,
  openCounts,
}: {
  projects: Project[]
  filter: Filter
  setFilter: (f: Filter) => void
  /** Live count of open prompts per project (see App: derived from the
   *  prompts query, so it follows every status change without a refresh). */
  openCounts?: OpenCounts
}) {
  // On a phone 36 projects wrap into six rows and push the board off-screen.
  // Collapsed = one horizontally scrollable line; the toggle shows them all.
  const isNarrow = useMediaQuery('(max-width: 640px)')
  const [showAll, setShowAll] = useState(false)
  const collapsed = isNarrow && !showAll
  return (
    <div className="chips" data-collapsed={collapsed}>
      <button className="chip" data-active={filter === 'all'} onClick={() => setFilter('all')}>
        Alle
      </button>
      <button className="chip" data-active={filter === 'none'} onClick={() => setFilter('none')}>
        Ohne Projekt
        <OpenBadge count={openCounts?.get('none') ?? 0} />
      </button>
      {projects.map((p) => (
        <ProjectChip
          key={p.id}
          p={p}
          active={filter === p.id}
          count={openCounts?.get(p.id) ?? 0}
          onClick={() => setFilter(p.id)}
        />
      ))}
      {isNarrow && projects.length > 4 && (
        <button
          className="chip chips-toggle"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          title={showAll ? 'Projektfilter einklappen' : 'Alle Projekte anzeigen'}
        >
          <Icon name={showAll ? 'unfold_less' : 'unfold_more'} />
          {showAll ? 'Weniger' : `Alle ${projects.length}`}
        </button>
      )}
    </div>
  )
}
