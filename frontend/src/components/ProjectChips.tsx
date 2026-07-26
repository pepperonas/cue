import { useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Project } from '../lib/types'
import { useReorderProjects } from '../state/queries'
import { useDragSensors } from '../lib/dnd'
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

function SortableChip({ p, active, count, onClick }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
  })
  return (
    <button
      ref={setNodeRef}
      className="chip"
      data-active={active}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 2 : undefined,
      }}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <span className="dot" style={{ background: p.color }} />
      {p.name}
      <OpenBadge count={count} />
    </button>
  )
}

/** The project filter chips, drag-sortable in place (same order source as the
 * Projekte view: `Project.sort_order` via POST /projects/reorder). "Alle" and
 * "Ohne Projekt" stay fixed at the front. */
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
  const reorder = useReorderProjects()
  // On a phone 36 projects wrap into six rows and push the board off-screen.
  // Collapsed = one horizontally scrollable line; the toggle shows them all.
  const isNarrow = useMediaQuery('(max-width: 640px)')
  const [showAll, setShowAll] = useState(false)
  const collapsed = isNarrow && !showAll
  // Suppress the click that fires on drop, so finishing a drag doesn't also
  // toggle the chip's filter.
  const justDragged = useRef(false)
  const sensors = useDragSensors()

  function onDragEnd(e: DragEndEvent) {
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = projects.findIndex((p) => p.id === active.id)
    const to = projects.findIndex((p) => p.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(projects, from, to)
    reorder.mutate(next.map((p, i) => ({ id: p.id, sort_order: i + 1 })))
  }

  function select(f: Filter) {
    if (justDragged.current) return
    setFilter(f)
  }

  return (
    <div className="chips" data-collapsed={collapsed}>
      <button className="chip" data-active={filter === 'all'} onClick={() => setFilter('all')}>
        Alle
      </button>
      <button className="chip" data-active={filter === 'none'} onClick={() => setFilter('none')}>
        Ohne Projekt
        <OpenBadge count={openCounts?.get('none') ?? 0} />
      </button>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={projects.map((p) => p.id)} strategy={rectSortingStrategy}>
          {projects.map((p) => (
            <SortableChip
              key={p.id}
              p={p}
              active={filter === p.id}
              count={openCounts?.get(p.id) ?? 0}
              onClick={() => select(p.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
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
