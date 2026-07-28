import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { AnimatePresence } from 'motion/react'
import type { BookmarkMovePayload } from '../lib/api'
import type { Project, Prompt } from '../lib/types'
import { vibrate } from '../lib/clipboard'
import { PromptCard } from './PromptCard'
import { Icon } from './ui'
import { useDragSensors } from '../lib/dnd'

interface Props {
  prompts: Prompt[]
  projects: Map<number, Project>
  dark: boolean
  selectedId: number | null
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onDuplicate?: (p: Prompt) => void
  onToggleBookmark: (p: Prompt) => void
  onToggleTested: (p: Prompt) => void
  // Prompt optimization (owner-only): undefined hides the button entirely.
  // Bookmarks are optimized UNIVERSALLY — the server derives that from the
  // same bookmark flag (see app/optimization/service.py).
  onOptimize?: (p: Prompt) => void
  optimizingIds?: number[]
  /** Anchored move of one bookmark — never a list of positions. */
  onMove: (move: BookmarkMovePayload & { id: number }) => void
}

export function BookmarksView({
  prompts,
  projects,
  dark,
  selectedId,
  onOpen,
  onCopy,
  onDuplicate,
  onToggleBookmark,
  onToggleTested,
  onOptimize,
  optimizingIds,
  onMove,
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

  const sensors = useDragSensors()

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
    // Anchored on a neighbour, not on an index: this list can be filtered, and
    // an index from a subset would renumber over the hidden bookmarks.
    const id = active.id as number
    const index = next.indexOf(id)
    const before = next[index + 1]
    const after = next[index - 1]
    if (before != null) onMove({ id, before_id: before })
    else if (after != null) onMove({ id, after_id: after })
    else onMove({ id, top: true })
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
                  onDuplicate={onDuplicate}
                  onToggleBookmark={onToggleBookmark}
                  onToggleTested={onToggleTested}
                  onOptimize={onOptimize}
                  optimizeBusy={optimizingIds?.includes(p.id) ?? false}
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
