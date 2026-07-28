import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core'
import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence } from 'motion/react'
import type { MovePayload } from '../lib/api'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { vibrate } from '../lib/clipboard'
import {
  capToggleLabel,
  columnKey,
  defaultGroupsOpen,
  groupByProject,
  isOpen,
  visibleCards,
} from '../lib/board-groups'
import { useDragSensors } from '../lib/dnd'
import { useIsMobile } from '../lib/media'
import { columnComparator } from '../lib/order'
import { PromptCard } from './PromptCard'
import { ProjectGroupSection, StatusSection } from './BoardSection'
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
  onDuplicate?: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
  onToggleTested?: (p: Prompt) => void
  onToggleBlocked?: (p: Prompt) => void
  // Prompt optimization (owner-only): undefined hides the button on the cards.
  onOptimize?: (p: Prompt) => void
  optimizingIds?: number[]
  /** Anchored move of a single card — never a list of positions (see onDragEnd). */
  onMove: (move: MovePayload & { id: number }) => void
  /** Same, for a dragged multi-selection: the block lands at one anchor. */
  onMoveMany: (move: MovePayload & { ids: number[] }) => void
  selectMode?: boolean
  selectedIds?: number[]
  onToggleSelect?: (p: Prompt) => void
  onModSelect?: (p: Prompt) => void
}

// Collapse state of the mobile sections, per browser session (the requirement
// is "keeps its state during the current session" — a new tab starts fresh).
const SECTION_KEY = 'cue-board-sections'

function loadSections(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(SECTION_KEY) || '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function group(prompts: Prompt[], columns: Status[]): Containers {
  const out: Containers = {}
  columns.forEach((c) => (out[c] = []))
  // Blocked sinks to the bottom; in DONE, tested prompts sink below untested
  // and sort by execution time (see lib/order.ts).
  const sorted = [...prompts].sort(columnComparator)
  for (const p of sorted) {
    if (out[p.status]) out[p.status].push(p.id)
  }
  return out
}

/** Desktop column (unchanged): always open, header is not interactive. */
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
  onDuplicate,
  onToggleBookmark,
  onToggleTested,
  onOptimize,
  optimizingIds,
  onToggleBlocked,
  onMove,
  onMoveMany,
  selectMode,
  selectedIds,
  onToggleSelect,
  onModSelect,
}: Props) {
  const isMobile = useIsMobile()
  const byId = useMemo(() => new Map(prompts.map((p) => [p.id, p])), [prompts])
  const [containers, setContainers] = useState<Containers>(() => group(prompts, columns))
  const [activeId, setActiveId] = useState<number | null>(null)
  // "Show all" toggles, keyed per section: `col:<status>` for a desktop column,
  // the group id for a mobile project group. Keyed rather than per status so
  // expanding one project group leaves the others capped.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Explicit open/closed choices for the mobile sections (status + project).
  const [sections, setSections] = useState<Record<string, boolean>>(loadSections)
  const dragging = useRef(false)

  // Re-sync from server data unless a drag is in progress.
  useEffect(() => {
    if (!dragging.current) setContainers(group(prompts, columns))
  }, [prompts, columns])

  const toggleSection = useCallback((id: string, next: boolean) => {
    setSections((prev) => {
      const merged = { ...prev, [id]: next }
      try {
        sessionStorage.setItem(SECTION_KEY, JSON.stringify(merged))
      } catch {
        /* private mode / quota — the UI still works, it just forgets */
      }
      return merged
    })
  }, [])

  // Touch/mouse/keyboard sensor split lives in lib/dnd.ts (shared with the
  // other sortable views).
  const sensors = useDragSensors()

  function findContainer(id: number | string): Status | undefined {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as Status
    for (const status of columns) {
      if (containers[status]?.includes(id as number)) return status
    }
    return undefined
  }

  const dragOrigin = useRef<Status | undefined>(undefined)
  // Ids travelling with this drag. Normally just the dragged card; if it is
  // part of a selection, the whole selection comes along (in board order).
  const dragSet = useRef<number[]>([])

  function onDragStart(e: DragStartEvent) {
    const id = e.active.id as number
    dragging.current = true
    setActiveId(id)
    dragOrigin.current = findContainer(id)

    const picked = selectMode && selectedIds?.includes(id) ? selectedIds : []
    if (picked.length > 1) {
      // Board order, not click order — the block must land the way it looked.
      const inOrder = columns.flatMap((status) =>
        (containers[status] ?? []).filter((x) => picked.includes(x)),
      )
      dragSet.current = inOrder
      // Lift the companions out of their columns so the stack reads as one
      // object; they come back from the server response after the drop.
      setContainers((prev) => {
        const next: Containers = {}
        for (const status of columns) {
          next[status] = (prev[status] ?? []).filter((x) => x === id || !picked.includes(x))
        }
        return next
      })
    } else {
      dragSet.current = [id]
    }
    vibrate(12) // haptic "lift" confirmation on touch devices
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to) return
    // Hovering a collapsed section opens it, so a card can be dropped into a
    // folded status without cancelling the drag first.
    if (isMobile && to !== from && sections[`col:${to}`] === false) {
      toggleSection(`col:${to}`, true)
    }
    if (from === to) return

    setContainers((prev) => {
      const next: Containers = { ...prev }
      next[from] = next[from].filter((x) => x !== active.id)
      const overIndex = next[to].indexOf(over.id as number)
      const insertAt = overIndex >= 0 ? overIndex : next[to].length
      next[to] = [...next[to].slice(0, insertAt), active.id as number, ...next[to].slice(insertAt)]
      return next
    })
  }

  function onDragCancel() {
    // Escape / lost pointer: drop every optimistic move and go back to server order.
    dragging.current = false
    setActiveId(null)
    dragOrigin.current = undefined
    setContainers(group(prompts, columns))
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    const origin = dragOrigin.current
    dragging.current = false
    setActiveId(null)
    dragOrigin.current = undefined
    if (!over) {
      setContainers(group(prompts, columns))
      return
    }
    const id = active.id as number
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to) return

    let next = containers
    let moved = from !== to // cross-column: onDragOver already applied the move
    if (from === to) {
      const items = [...containers[to]]
      const oldIndex = items.indexOf(id)
      const newIndex = items.indexOf(over.id as number)
      if (oldIndex !== newIndex && newIndex >= 0) {
        items.splice(newIndex, 0, items.splice(oldIndex, 1)[0])
        next = { ...containers, [to]: items }
        setContainers(next)
        moved = true
      }
    }
    // A card dragged INTO done from another column always lands at the TOP.
    const toTop = to === 'done' && !!origin && origin !== 'done'
    if (toTop) {
      next = { ...next, done: [id, ...next['done'].filter((x) => x !== id)] }
      setContainers(next)
    }
    if (!moved) return
    vibrate(8)

    // Anchor the move on a NEIGHBOUR instead of an index: this board may be
    // filtered, and an index derived from a subset would renumber the column
    // on top of the cards it cannot see (see backend app/ordering.py).
    const column = next[to] ?? []
    const index = column.indexOf(id)
    const before = column[index + 1]
    const after = column[index - 1]
    const ids = dragSet.current.length > 1 ? dragSet.current : undefined
    dragSet.current = []
    const anchor: MovePayload =
      toTop || (before == null && after == null)
        ? { top: toTop || to === 'done' }
        : before != null
          ? { before_id: before }
          : { after_id: after }
    if (ids) onMoveMany({ ids, status: to, ...anchor })
    else onMove({ id, status: to, ...anchor })
  }

  const activePrompt = activeId != null ? byId.get(activeId) : undefined
  const dragCount = activeId != null ? Math.max(dragSet.current.length, 1) : 0

  /** Render one card (shared by the desktop and mobile trees). */
  const renderCard = useCallback(
    (id: number, idx: number) => {
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
          onToggleBlocked={onToggleBlocked}
          selectMode={selectMode}
          selectedForMerge={selectedIds?.includes(id)}
          onToggleSelect={onToggleSelect}
          onModSelect={onModSelect}
        />
      )
    },
    [
      byId,
      dark,
      onCopy,
      onDuplicate,
      onModSelect,
      onOpen,
      onOptimize,
      onToggleBlocked,
      onToggleBookmark,
      onToggleSelect,
      onToggleTested,
      optimizingIds,
      projects,
      selectMode,
      selectedId,
      selectedIds,
    ],
  )

  /** Cap toggle for one section (desktop column or mobile project group). */
  function capToggle(key: string, total: number, hidden: number) {
    if (activeId != null) return null
    const isExpanded = expanded[key] ?? false
    const label = capToggleLabel(total, hidden, isExpanded)
    if (!label) return null
    return (
      <button
        className="col-more"
        onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
      >
        <Icon name={isExpanded ? 'unfold_less' : 'unfold_more'} />
        {label}
      </button>
    )
  }

  // German screen-reader announcements (dnd-kit ships English defaults).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Prompt ${byId.get(active.id as number)?.title ?? ''} aufgenommen.`,
    onDragOver: ({ over }) =>
      over ? `Über ${labelOf(over.id, byId)}.` : 'Außerhalb einer Spalte.',
    onDragEnd: ({ over }) =>
      over ? `Abgelegt bei ${labelOf(over.id, byId)}.` : 'Abgelegt, Position unverändert.',
    onDragCancel: () => 'Verschieben abgebrochen.',
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      collisionDetection={closestCorners}
      // Start scrolling earlier and slower than the default so a one-handed
      // drag near the screen edge stays controllable on a phone.
      autoScroll={{ threshold: { x: 0, y: 0.18 }, acceleration: 12 }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={`board${isMobile ? ' board--mobile' : ''}`}>
        {columns.map((status) => {
          const all = containers[status] ?? []
          if (!isMobile) {
            const colKey = columnKey(status)
            const { shown: visible, hidden } = visibleCards(all, {
              expanded: expanded[colKey],
              dragging: activeId != null,
            })
            return (
              <Column key={status} status={status} count={all.length}>
                <SortableContext items={visible} strategy={verticalListSortingStrategy}>
                  <AnimatePresence>{visible.map(renderCard)}</AnimatePresence>
                  {capToggle(colKey, all.length, hidden)}
                  {all.length === 0 && (
                    <div className="empty" style={{ padding: 'var(--gap-4)' }}>
                      <span className="muted">Leer</span>
                    </div>
                  )}
                </SortableContext>
              </Column>
            )
          }

          // ---- mobile: status section > project groups > cards ----
          const groups = groupByProject(all, byId, projects, status)
          const groupsOpenByDefault = defaultGroupsOpen(all.length)
          const sectionOpen = isOpen(sections, `col:${status}`, true)
          const visibleIds: number[] = []
          const bodies = groups.map((g) => {
            const groupOpen = isOpen(sections, g.id, groupsOpenByDefault)
            const { shown, hidden } = visibleCards(g.ids, {
              open: groupOpen,
              expanded: expanded[g.id],
              dragging: activeId != null,
            })
            visibleIds.push(...shown)
            return (
              <ProjectGroupSection
                key={g.id}
                id={g.id}
                name={g.name}
                color={g.color}
                count={g.ids.length}
                open={groupOpen}
                onToggle={() => toggleSection(g.id, !groupOpen)}
              >
                {shown.map(renderCard)}
                {groupOpen && capToggle(g.id, g.ids.length, hidden)}
              </ProjectGroupSection>
            )
          })

          return (
            <StatusSection
              key={status}
              status={status}
              count={all.length}
              open={sectionOpen}
              onToggle={() => toggleSection(`col:${status}`, !sectionOpen)}
            >
              <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
                {bodies}
                {all.length === 0 && (
                  <div className="empty" style={{ padding: 'var(--gap-3)' }}>
                    <span className="muted">Leer</span>
                  </div>
                )}
              </SortableContext>
            </StatusSection>
          )
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activePrompt ? (
          <div className={`drag-stack${dragCount > 1 ? ' drag-stack--many' : ''}`}>
            <div className="card card--drag-preview" style={{ cursor: 'grabbing' }}>
              <div className="card-title">{activePrompt.title}</div>
              <div className="card-body-preview">{activePrompt.body}</div>
            </div>
            {dragCount > 1 && (
              <span className="drag-count" aria-hidden="true">
                {dragCount}
              </span>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function labelOf(id: number | string, byId: Map<number, Prompt>): string {
  if (typeof id === 'string' && id.startsWith('col:')) {
    return STATUS_LABEL[id.slice(4) as Status] ?? id
  }
  return byId.get(id as number)?.title ?? 'Position'
}
