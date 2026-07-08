import { useRef } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Project } from '../lib/types'
import { useReorderProjects } from '../state/queries'

type Filter = number | 'all' | 'none'

interface ChipProps {
  p: Project
  active: boolean
  onClick: () => void
}

function SortableChip({ p, active, onClick }: ChipProps) {
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
}: {
  projects: Project[]
  filter: Filter
  setFilter: (f: Filter) => void
}) {
  const reorder = useReorderProjects()
  // Suppress the click that fires on drop, so finishing a drag doesn't also
  // toggle the chip's filter.
  const justDragged = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

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
    <div className="chips">
      <button className="chip" data-active={filter === 'all'} onClick={() => setFilter('all')}>
        Alle
      </button>
      <button className="chip" data-active={filter === 'none'} onClick={() => setFilter('none')}>
        Ohne Projekt
      </button>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={projects.map((p) => p.id)} strategy={rectSortingStrategy}>
          {projects.map((p) => (
            <SortableChip key={p.id} p={p} active={filter === p.id} onClick={() => select(p.id)} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
