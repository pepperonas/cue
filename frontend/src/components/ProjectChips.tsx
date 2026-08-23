import { useMemo, useRef, useState } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { sortProjectsByAttention, withReorderedTail } from '../lib/board-groups'
import { useDragSensors } from '../lib/dnd'
import { useMediaQuery } from '../lib/media'
import type { Project } from '../lib/types'
import { useReorderProjects } from '../state/queries'
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

function ChipBody({ p, count }: { p: Project; count: number }) {
  return (
    <>
      <span className="dot" style={{ background: p.color }} />
      {p.name}
      <OpenBadge count={count} />
    </>
  )
}

/** Placed by its open count — dragging it would be undone on the next render. */
function FixedChip({ p, active, count, onClick }: ChipProps) {
  return (
    <button className="chip" data-active={active} onClick={onClick}>
      <ChipBody p={p} count={count} />
    </button>
  )
}

/** Nothing open, so nothing overrules the manual order: this one drags. */
function SortableChip({ p, active, count, onClick }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
  })
  return (
    <button
      ref={setNodeRef}
      className="chip chip--sortable"
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
      <ChipBody p={p} count={count} />
    </button>
  )
}

/** The project filter chips. "Alle" and "Ohne Projekt" stay fixed at the front.
 *
 * The order is DERIVED: projects with open prompts lead, most open first; the
 * manual `sort_order` is the tiebreak and governs everything with an empty
 * queue.
 *
 * **Only the quiet tail is drag-sortable.** For a project with open prompts the
 * count decides the position, so a drop there would be undone by the next
 * render — the chip would visibly snap back. The projects with nothing open
 * have no count to overrule them, so their order IS the manual one and a drag
 * there does exactly what it looks like. Reordering the busy projects among
 * themselves still happens in the Projekte tab, which is not count-sorted.
 */
export function ProjectChips({
  projects,
  filter,
  setFilter,
  openCounts,
}: {
  /** In the STORED order — the display order is derived here. */
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

  const countOf = (p: Project) => openCounts?.get(p.id) ?? 0
  const shown = useMemo(
    () => sortProjectsByAttention(projects, openCounts ?? new Map()),
    [projects, openCounts],
  )
  const sortableIds = shown.filter((p) => countOf(p) === 0).map((p) => p.id)

  function onDragEnd(e: DragEndEvent) {
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = sortableIds.indexOf(active.id as number)
    const to = sortableIds.indexOf(over.id as number)
    if (from < 0 || to < 0) return
    // The payload is the full stored order: the tail is permuted among its own
    // slots, so the busy projects keep the tiebreak order they had.
    const next = withReorderedTail(projects, arrayMove(sortableIds, from, to))
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
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          {shown.map((p) =>
            countOf(p) === 0 ? (
              <SortableChip
                key={p.id}
                p={p}
                active={filter === p.id}
                count={0}
                onClick={() => select(p.id)}
              />
            ) : (
              <FixedChip
                key={p.id}
                p={p}
                active={filter === p.id}
                count={countOf(p)}
                onClick={() => select(p.id)}
              />
            ),
          )}
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
