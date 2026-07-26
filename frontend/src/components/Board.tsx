import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core'
import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence } from 'motion/react'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { vibrate } from '../lib/clipboard'
import { defaultGroupsOpen, groupByProject, isOpen } from '../lib/board-groups'
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
  onReorder: (items: { id: number; status: Status; sort_order: number }[]) => void
  selectMode?: boolean
  selectedIds?: number[]
  onToggleSelect?: (p: Prompt) => void
  onModSelect?: (p: Prompt) => void
}

const COLUMN_CAP = 10
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
  onReorder,
  selectMode,
  selectedIds,
  onToggleSelect,
  onModSelect,
}: Props) {
  const isMobile = useIsMobile()
  const byId = useMemo(() => new Map(prompts.map((p) => [p.id, p])), [prompts])
  const [containers, setContainers] = useState<Containers>(() => group(prompts, columns))
  const [activeId, setActiveId] = useState<number | null>(null)
  // Per-column "show all" toggle; the first COLUMN_CAP cards are always shown.
  const [expanded, setExpanded] = useState<Partial<Record<Status, boolean>>>({})
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

  function onDragStart(e: DragStartEvent) {
    dragging.current = true
    setActiveId(e.active.id as number)
    dragOrigin.current = findContainer(e.active.id)
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
    // A card dragged INTO done from another column always lands at the TOP.
    if (to === 'done' && dragOrigin.current && dragOrigin.current !== 'done') {
      const items = next['done'].filter((x) => x !== active.id)
      next = { ...next, done: [active.id as number, ...items] }
      setContainers(next)
    }
    dragOrigin.current = undefined
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

  function moreButton(status: Status, total: number) {
    if (total <= COLUMN_CAP || activeId != null) return null
    return (
      <button
        className="col-more"
        onClick={() => setExpanded((prev) => ({ ...prev, [status]: !prev[status] }))}
      >
        <Icon name={expanded[status] ? 'unfold_less' : 'unfold_more'} />
        {expanded[status] ? 'Weniger anzeigen' : `${total - COLUMN_CAP} weitere anzeigen`}
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
            const visible = expanded[status] || activeId != null ? all : all.slice(0, COLUMN_CAP)
            return (
              <Column key={status} status={status} count={all.length}>
                <SortableContext items={visible} strategy={verticalListSortingStrategy}>
                  <AnimatePresence>{visible.map(renderCard)}</AnimatePresence>
                  {moreButton(status, all.length)}
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
            const shown =
              groupOpen && (expanded[status] || activeId != null || g.ids.length <= COLUMN_CAP)
                ? g.ids
                : groupOpen
                  ? g.ids.slice(0, COLUMN_CAP)
                  : []
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
                {g.ids.length > shown.length && shown.length > 0 && (
                  <button
                    className="col-more"
                    onClick={() => setExpanded((prev) => ({ ...prev, [status]: !prev[status] }))}
                  >
                    <Icon name="unfold_more" />
                    {g.ids.length - shown.length} weitere anzeigen
                  </button>
                )}
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
          <div className="card card--drag-preview" style={{ cursor: 'grabbing' }}>
            <div className="card-title">{activePrompt.title}</div>
            <div className="card-body-preview">{activePrompt.body}</div>
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
