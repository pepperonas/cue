import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { AnimatePresence } from 'motion/react'
import type { Project, Prompt } from '../lib/types'
import { vibrate } from '../lib/clipboard'
import { PromptCard } from './PromptCard'
import { Icon } from './ui'

interface Props {
  prompts: Prompt[]
  projects: Map<number, Project>
  dark: boolean
  selectedId: number | null
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onToggleBookmark: (p: Prompt) => void
  onReorder: (items: { id: number; bookmark_order: number }[]) => void
}

export function BookmarksView({
  prompts,
  projects,
  dark,
  selectedId,
  onOpen,
  onCopy,
  onToggleBookmark,
  onReorder,
}: Props) {
  const byId = useMemo(() => new Map(prompts.map((p) => [p.id, p])), [prompts])

  const serverOrder = useMemo(
    () =>
      prompts
        .filter((p) => p.bookmarked)
        .sort((a, b) => a.bookmark_order - b.bookmark_order || a.id - b.id)
        .map((p) => p.id),
    [prompts],
  )

  const [order, setOrder] = useState<number[]>(serverOrder)
  const [activeId, setActiveId] = useState<number | null>(null)
  const dragging = useRef(false)

  // Re-sync from server unless a drag is in progress.
  useEffect(() => {
    if (!dragging.current) setOrder(serverOrder)
  }, [serverOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function onDragStart(e: DragStartEvent) {
    dragging.current = true
    setActiveId(e.active.id as number)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    dragging.current = false
    setActiveId(null)
    if (!over || active.id === over.id) return
    const from = order.indexOf(active.id as number)
    const to = order.indexOf(over.id as number)
    if (from < 0 || to < 0) return
    const next = arrayMove(order, from, to)
    setOrder(next)
    vibrate(8)
    onReorder(next.map((id, idx) => ({ id, bookmark_order: idx + 1 })))
  }

  if (serverOrder.length === 0) {
    return (
      <div className="empty">
        <Icon name="bookmark_border" />
        <h3 style={{ margin: 0 }}>Keine Bookmarks</h3>
        <p className="muted">
          Markiere Prompts mit dem Lesezeichen-Symbol, um sie hier zu sammeln und frei
          anzuordnen.
        </p>
      </div>
    )
  }

  const activePrompt = activeId != null ? byId.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="bookmark-list">
          <AnimatePresence>
            {order.map((id, idx) => {
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
                />
              )
            })}
          </AnimatePresence>
        </div>
      </SortableContext>
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
