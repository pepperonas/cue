import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'motion/react'
import { vibrate } from '../lib/clipboard'
import { springs } from '../lib/motion'
import { groupSnippets, UNGROUPED_KEY, UNGROUPED_LABEL } from '../lib/snippets'
import type { Snippet, SnippetImportResult } from '../lib/types'
import {
  useBulkDeleteSnippets,
  useBulkMoveSnippets,
  useCreateSnippetGroup,
  useDeleteSnippet,
  useDeleteSnippetGroup,
  useImportSnippets,
  useRenameSnippetGroup,
  useReorderSnippetGroups,
  useReorderSnippets,
  useSnippetGroups,
  useSnippets,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Confirm } from './Confirm'
import { SnippetEditor } from './SnippetEditor'
import { Button, Icon, IconButton } from './ui'

const COLLAPSE_KEY = 'cue-snippet-collapsed'

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

// dnd id namespaces: snippets are numeric ids, sections are `sec:<name>`.
const secId = (key: string) => `sec:${key}`
const isSec = (id: unknown): id is string => typeof id === 'string' && id.startsWith('sec:')

type Containers = Record<string, number[]>

export function SnippetsView() {
  const toast = useToast()
  const { data: snippets, isLoading } = useSnippets()
  const { data: groups } = useSnippetGroups()
  const reorder = useReorderSnippets()
  const reorderGroups = useReorderSnippetGroups()
  const bulkMove = useBulkMoveSnippets()
  const bulkDelete = useBulkDeleteSnippets()
  const createGroup = useCreateSnippetGroup()
  const renameGroup = useRenameSnippetGroup()
  const deleteGroup = useDeleteSnippetGroup()
  const del = useDeleteSnippet()
  const importBackup = useImportSnippets()

  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [confirmGroup, setConfirmGroup] = useState<{ id: number; name: string } | null>(null)
  const [importResult, setImportResult] = useState<SnippetImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sections = useMemo(
    () => groupSnippets(snippets ?? [], groups ?? []),
    [snippets, groups],
  )
  const byId = useMemo(() => new Map((snippets ?? []).map((s) => [s.id, s])), [snippets])

  // Container state mirrors sections while idle; diverges only mid-drag.
  const [containers, setContainers] = useState<Containers>({})
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) {
      const next: Containers = {}
      for (const sec of sections) next[sec.key] = sec.snippets.map((s) => s.id)
      setContainers(next)
    }
  }, [sections])

  const [activeId, setActiveId] = useState<number | string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  function findContainer(id: number | string): string | undefined {
    if (isSec(id)) return id.slice(4)
    for (const key of Object.keys(containers)) {
      if (containers[key]?.includes(id as number)) return key
    }
    return undefined
  }

  function onDragStart(e: DragStartEvent) {
    dragging.current = true
    setActiveId(e.active.id)
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over || isSec(active.id)) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || to === undefined || from === to) return
    setContainers((prev) => {
      const next = { ...prev }
      next[from] = (next[from] ?? []).filter((x) => x !== active.id)
      const target = [...(next[to] ?? [])]
      const overIndex = target.indexOf(over.id as number)
      const insertAt = overIndex >= 0 ? overIndex : target.length
      target.splice(insertAt, 0, active.id as number)
      next[to] = target
      return next
    })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    dragging.current = false
    setActiveId(null)
    if (!over) return

    // Group header dragged onto another header -> group reorder.
    if (isSec(active.id)) {
      if (!isSec(over.id) || active.id === over.id) return
      const orderable = sections.filter((s) => s.groupId != null)
      const names = orderable.map((s) => s.key)
      const fromIdx = names.indexOf((active.id as string).slice(4))
      const toIdx = names.indexOf((over.id as string).slice(4))
      if (fromIdx < 0 || toIdx < 0) return
      const moved = [...orderable]
      moved.splice(toIdx, 0, moved.splice(fromIdx, 1)[0])
      vibrate(8)
      reorderGroups.mutate(moved.map((s, i) => ({ id: s.groupId as number, sort_order: i + 1 })))
      return
    }

    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || to === undefined) return
    let next = containers
    if (from === to && !isSec(over.id)) {
      const items = [...(containers[to] ?? [])]
      const oldIndex = items.indexOf(active.id as number)
      const newIndex = items.indexOf(over.id as number)
      if (oldIndex !== newIndex && newIndex >= 0) {
        items.splice(newIndex, 0, items.splice(oldIndex, 1)[0])
        next = { ...containers, [to]: items }
        setContainers(next)
      }
    }
    vibrate(8)
    const payload: { id: number; group_name: string; sort_order: number }[] = []
    for (const key of new Set([from, to])) {
      next[key]?.forEach((id, idx) => {
        const s = byId.get(id)
        if (!s) return
        if ((s.group_name ?? UNGROUPED_KEY) !== key || s.sort_order !== idx + 1) {
          payload.push({ id, group_name: key, sort_order: idx + 1 })
        }
      })
    }
    if (payload.length) reorder.mutate(payload)
  }

  function toggleSelect(s: Snippet) {
    setSelectedIds((prev) =>
      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
    )
  }

  async function onImportFiles(files: FileList | File[] | null) {
    const file = files && files[0]
    if (!file) return
    setImportResult(null)
    importBackup.mutate(file, {
      onSuccess: (res) => {
        setImportResult(res)
        toast.show(
          `Import: ${res.imported} neu, ${res.updated} aktualisiert`,
          res.errors.length ? 'error' : 'success',
        )
      },
      onError: (err) => toast.show(err instanceof Error ? err.message : 'Import fehlgeschlagen', 'error'),
    })
  }

  function addGroup() {
    const name = window.prompt('Name der neuen Gruppe:')?.trim()
    if (!name) return
    createGroup.mutate(name, {
      onError: (e) => toast.show(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen', 'error'),
    })
  }

  function renameGroupPrompt(id: number, current: string) {
    const name = window.prompt('Gruppe umbenennen:', current)?.trim()
    if (!name || name === current) return
    renameGroup.mutate(
      { id, name },
      { onError: (e) => toast.show(e instanceof Error ? e.message : 'Umbenennen fehlgeschlagen', 'error') },
    )
  }

  const activeSnippet = typeof activeId === 'number' ? byId.get(activeId) : undefined
  const groupChoices = sections.filter((s) => s.groupId != null).map((s) => s.name)

  return (
    <div
      className={`snippets ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault()
          setDragOver(false)
          void onImportFiles(e.dataTransfer.files)
        }
      }}
    >
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 'var(--gap-4)' }}>
        <h1 style={{ font: 'var(--headline-m)', margin: 0, flex: 1 }}>Snippets</h1>
        <button className="chip" onClick={addGroup}>
          <Icon name="create_new_folder" /> Neue Gruppe
        </button>
        <button className="chip" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" /> IR-Backup importieren
        </button>
        <a className="chip" href="/api/snippets/export" download>
          <Icon name="download" /> Als IR-Backup exportieren
        </a>
        <Button icon="add" onClick={() => setCreating(true)}>
          Neues Snippet
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onImportFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <p className="muted snippets-hint">
        <Icon name="info" /> IR importiert mergend (Merge-Key = Abkürzung). In cue gelöschte
        Snippets bleiben in IR bestehen und müssen dort manuell gelöscht werden. Eine Abkürzung
        zu ändern legt in IR ein neues Snippet an.
      </p>

      {importResult && (
        <motion.div
          className={`import-banner ${importResult.errors.length ? 'has-errors' : ''}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.spatialFast}
        >
          <Icon name={importResult.errors.length ? 'warning' : 'check_circle'} />
          <div className="grow">
            <strong>
              {importResult.imported} neu · {importResult.updated} aktualisiert ·{' '}
              {importResult.groups_created} Gruppen angelegt · {importResult.skipped} übersprungen
            </strong>
            {importResult.errors.length > 0 && (
              <ul>
                {importResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
          <IconButton icon="close" label="Schließen" onClick={() => setImportResult(null)} />
        </motion.div>
      )}

      {isLoading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (snippets ?? []).length === 0 && (groups ?? []).length === 0 ? (
        <div className="empty">
          <Icon name="data_object" />
          <h3 style={{ margin: 0 }}>Keine Snippets</h3>
          <p className="muted">
            {'Importiere ein IR-Backup („Settings → Backup & restore → Export") oder lege ein Snippet an.'}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={sections.filter((s) => s.groupId != null).map((s) => secId(s.key))}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((sec) => (
              <SnippetSectionView
                key={sec.key || '∅'}
                sectionKey={sec.key}
                name={sec.key === UNGROUPED_KEY ? UNGROUPED_LABEL : sec.name}
                groupId={sec.groupId}
                ids={containers[sec.key] ?? []}
                byId={byId}
                collapsed={collapsed.includes(sec.key)}
                onToggle={() => toggleCollapse(sec.key)}
                onRename={sec.groupId != null ? () => renameGroupPrompt(sec.groupId as number, sec.name) : undefined}
                onDelete={
                  sec.groupId != null
                    ? () => setConfirmGroup({ id: sec.groupId as number, name: sec.name })
                    : undefined
                }
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onEdit={(s) => setEditing(s)}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeSnippet ? (
              <div className="snippet-row dragging">
                <code className="snippet-abbr">{activeSnippet.abbreviation}</code>
                <span className="lt">{activeSnippet.title || activeSnippet.body.slice(0, 60)}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {selectedIds.length > 0 && (
        <motion.div
          className="select-bar"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.spatial}
        >
          <span className="select-count">{selectedIds.length} ausgewählt</span>
          <button className="btn btn--text" onClick={() => setSelectedIds([])}>
            Abbrechen
          </button>
          <select
            className="select"
            style={{ maxWidth: 220 }}
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value
              if (value === '') return
              bulkMove.mutate(
                { ids: selectedIds, groupName: value === UNGROUPED_LABEL ? '' : value },
                {
                  onSuccess: () => {
                    toast.show('Verschoben', 'success')
                    setSelectedIds([])
                  },
                },
              )
              e.target.value = ''
            }}
          >
            <option value="">Verschieben nach…</option>
            <option value={UNGROUPED_LABEL}>{UNGROUPED_LABEL}</option>
            {groupChoices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            className="btn btn--danger"
            onClick={() => {
              bulkDelete.mutate(selectedIds, {
                onSuccess: () => {
                  toast.show(`${selectedIds.length} Snippets gelöscht`, 'success')
                  setSelectedIds([])
                },
              })
            }}
          >
            <Icon name="delete" /> Löschen
          </button>
        </motion.div>
      )}

      <AnimatePresence>
        {(creating || editing) && (
          <SnippetEditor
            key="snippet-editor"
            snippet={editing}
            snippets={snippets ?? []}
            groups={groupChoices}
            onClose={() => {
              setCreating(false)
              setEditing(null)
            }}
            onDelete={
              editing
                ? () => {
                    del.mutate(editing.id, {
                      onSuccess: () => toast.show('Snippet gelöscht', 'success'),
                    })
                    setEditing(null)
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>

      {confirmGroup && (
        <Confirm
          title={`Gruppe „${confirmGroup.name}" löschen?`}
          message="Die Snippets bleiben erhalten und werden ungruppiert."
          confirmLabel="Löschen"
          onCancel={() => setConfirmGroup(null)}
          onConfirm={() => {
            deleteGroup.mutate(confirmGroup.id, {
              onSuccess: () => toast.show('Gruppe gelöscht', 'success'),
            })
            setConfirmGroup(null)
          }}
        />
      )}
    </div>
  )
}

function SnippetSectionView({
  sectionKey,
  name,
  groupId,
  ids,
  byId,
  collapsed,
  onToggle,
  onRename,
  onDelete,
  selectedIds,
  onToggleSelect,
  onEdit,
}: {
  sectionKey: string
  name: string
  groupId: number | null
  ids: number[]
  byId: Map<number, Snippet>
  collapsed: boolean
  onToggle: () => void
  onRename?: () => void
  onDelete?: () => void
  selectedIds: number[]
  onToggleSelect: (s: Snippet) => void
  onEdit: (s: Snippet) => void
}) {
  // The header is sortable (group reorder) when it's a real group.
  const sortable = useSortable({ id: secId(sectionKey), disabled: groupId == null })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: secId(sectionKey),
    data: { section: sectionKey },
  })
  const headerStyle = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }

  return (
    <section
      className={`snippet-group ${sortable.isDragging ? 'dragging' : ''}`}
      ref={sortable.setNodeRef}
      style={headerStyle}
    >
      <div className="snippet-group-head" data-over={isOver}>
        {groupId != null && (
          <span
            className="drag-handle"
            title="Gruppe verschieben"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <Icon name="drag_indicator" />
          </span>
        )}
        <button className="snippet-group-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <Icon name="chevron_right" className={`list-chevron ${collapsed ? '' : 'open'}`} />
          <span className="list-group-label">{name}</span>
          <span className="count">{ids.length}</span>
        </button>
        {onRename && <IconButton icon="edit" label="Umbenennen" onClick={onRename} />}
        {onDelete && <IconButton icon="delete" label="Gruppe löschen" onClick={onDelete} />}
      </div>
      {!collapsed && (
        <div ref={setDropRef} className="snippet-list" data-over={isOver}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {ids.length === 0 ? (
              <div className="muted list-group-empty">Leer — Snippets hierher ziehen</div>
            ) : (
              ids.map((id) => {
                const s = byId.get(id)
                if (!s) return null
                return (
                  <SnippetRow
                    key={id}
                    snippet={s}
                    selected={selectedIds.includes(id)}
                    onToggleSelect={() => onToggleSelect(s)}
                    onEdit={() => onEdit(s)}
                  />
                )
              })
            )}
          </SortableContext>
        </div>
      )}
    </section>
  )
}

function SnippetRow({
  snippet,
  selected,
  onToggleSelect,
  onEdit,
}: {
  snippet: Snippet
  selected: boolean
  onToggleSelect: () => void
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: snippet.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`snippet-row ${isDragging ? 'dragging' : ''} ${selected ? 'merge-selected' : ''}`}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          onToggleSelect()
          return
        }
        onEdit()
      }}
      title="Klick zum Bearbeiten · Cmd/Ctrl+Klick zum Auswählen"
    >
      <code className="snippet-abbr">{snippet.abbreviation}</code>
      <span className="lt grow">{snippet.title || snippet.body.split('\n')[0]}</span>
      {selected && <Icon name="check_box" className="proj-menu-check" />}
    </div>
  )
}
