import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence } from 'motion/react'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { vibrate } from '../lib/clipboard'
import { PromptCard } from './PromptCard'
import { Icon } from './ui'

type Containers = Record<string, number[]>

interface Props {
  prompts: Prompt[]
  projects: Map<number, Project>
  columns: Status[]
  dark: boolean
  selectedId: number | null
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
  onToggleTested?: (p: Prompt) => void
  onReorder: (items: { id: number; status: Status; sort_order: number }[]) => void
}

function group(prompts: Prompt[], columns: Status[]): Containers {
  const out: Containers = {}
  columns.forEach((c) => (out[c] = []))
  const sorted = [...prompts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  for (const p of sorted) {
    if (out[p.status]) out[p.status].push(p.id)
  }
  return out
}

function Column({
  status,
  children,
  count,
}: {
  status: Status
  children: React.ReactNode
  count: number
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status } })
  return (
    <div ref={setNodeRef} className="column" data-over={isOver}>
      <div className="column-head">
        <Icon name={STATUS_ICON[status]} className={`st-icon ${STATUS_CLASS[status]}`} />
        {STATUS_LABEL[status]}
        <span className="count">{count}</span>
      </div>
      <div className="column-list">{children}</div>
    </div>
  )
}

export function Board({
  prompts,
  projects,
  columns,
  dark,
  selectedId,
  onOpen,
  onCopy,
  onToggleBookmark,
  onToggleTested,
  onReorder,
}: Props) {
  const byId = useMemo(() => new Map(prompts.map((p) => [p.id, p])), [prompts])
  const [containers, setContainers] = useState<Containers>(() => group(prompts, columns))
  const [activeId, setActiveId] = useState<number | null>(null)
  const dragging = useRef(false)

  // Re-sync from server data unless a drag is in progress.
  useEffect(() => {
    if (!dragging.current) setContainers(group(prompts, columns))
  }, [prompts, columns])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function findContainer(id: number | string): Status | undefined {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as Status
    for (const status of columns) {
      if (containers[status]?.includes(id as number)) return status
    }
    return undefined
  }

  function onDragStart(e: DragStartEvent) {
    dragging.current = true
    setActiveId(e.active.id as number)
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to || from === to) return

    setContainers((prev) => {
      const next: Containers = { ...prev }
      next[from] = next[from].filter((x) => x !== active.id)
      const overIndex = next[to].indexOf(over.id as number)
      const insertAt = overIndex >= 0 ? overIndex : next[to].length
      next[to] = [...next[to].slice(0, insertAt), active.id as number, ...next[to].slice(insertAt)]
      return next
    })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    dragging.current = false
    setActiveId(null)
    if (!over) {
      setContainers(group(prompts, columns))
      return
    }
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to) return

    let next = containers
    if (from === to) {
      const items = [...containers[to]]
      const oldIndex = items.indexOf(active.id as number)
      const newIndex = items.indexOf(over.id as number)
      if (oldIndex !== newIndex && newIndex >= 0) {
        items.splice(newIndex, 0, items.splice(oldIndex, 1)[0])
        next = { ...containers, [to]: items }
        setContainers(next)
      }
    }
    vibrate(8)

    // Build the reorder payload for every card in the affected columns.
    const affected = new Set([from, to])
    const payload: { id: number; status: Status; sort_order: number }[] = []
    for (const status of affected) {
      next[status]?.forEach((id, idx) => {
        const p = byId.get(id)
        if (!p) return
        if (p.status !== status || p.sort_order !== idx + 1) {
          payload.push({ id, status, sort_order: idx + 1 })
        }
      })
    }
    if (payload.length) onReorder(payload)
  }

  const activePrompt = activeId != null ? byId.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="board">
        {columns.map((status) => (
          <Column key={status} status={status} count={containers[status]?.length ?? 0}>
            <SortableContext
              items={containers[status] ?? []}
              strategy={verticalListSortingStrategy}
            >
              <AnimatePresence>
                {(containers[status] ?? []).map((id, idx) => {
                  const p = byId.get(id)
                  if (!p) return null
                  return (
                    <PromptCard
                      key={id}
                      prompt={p}
                      project={p.project_id ? projects.get(p.project_id) : undefined}
                      dark={dark}
                      index={idx}
                      selected={selectedId === id}
                      onOpen={onOpen}
                      onCopy={onCopy}
                      onToggleBookmark={onToggleBookmark}
                      onToggleTested={onToggleTested}
                    />
                  )
                })}
              </AnimatePresence>
              {(containers[status]?.length ?? 0) === 0 && (
                <div className="empty" style={{ padding: 'var(--gap-4)' }}>
                  <span className="muted">Leer</span>
                </div>
              )}
            </SortableContext>
          </Column>
        ))}
      </div>
      <DragOverlay>
        {activePrompt ? (
          <div className="card dragging" style={{ cursor: 'grabbing' }}>
            <div className="card-title">{activePrompt.title}</div>
            <div className="card-body-preview">{activePrompt.body}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
