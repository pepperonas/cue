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
import { copyText, vibrate } from '../lib/clipboard'
import { springs } from '../lib/motion'
import { filterSnippets, groupSnippets, UNGROUPED_KEY, UNGROUPED_LABEL } from '../lib/snippets'
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
  useSyncSettings,
  useToggleGroupSync,
  useUpdateSyncSettings,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Confirm } from './Confirm'
import { InputDialog } from './InputDialog'
import { SnippetEditor } from './SnippetEditor'
import { ToggleIconButton } from './ToggleIconButton'
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
  const { data: syncSettings } = useSyncSettings()
  const toggleGroupSync = useToggleGroupSync()
  const updateSync = useUpdateSyncSettings()
  const syncedByGroupId = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g.synced])),
    [groups],
  )

  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [confirmGroup, setConfirmGroup] = useState<{ id: number; name: string } | null>(null)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [confirmSnippet, setConfirmSnippet] = useState<Snippet | null>(null)
  const [groupDialog, setGroupDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: number; current: string } | null
  >(null)
  const [selectMode, setSelectMode] = useState(false)
  const [query, setQuery] = useState('')
  const [importResult, setImportResult] = useState<SnippetImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const searching = query.trim().length > 0
  const sections = useMemo(() => {
    const visible = filterSnippets(snippets ?? [], query)
    const all = groupSnippets(visible, groups ?? [])
    // While searching, hide sections without matches (incl. "Ohne Gruppe").
    return searching ? all.filter((sec) => sec.snippets.length > 0) : all
  }, [snippets, groups, query, searching])
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

  const existingGroupNames = useMemo(
    () => new Set((groups ?? []).map((g) => g.name.toLowerCase())),
    [groups],
  )

  function submitGroupDialog(name: string) {
    if (!groupDialog) return
    const opts = {
      onSuccess: () => setGroupDialog(null),
      onError: (e: unknown) =>
        toast.show(e instanceof Error ? e.message : 'Fehlgeschlagen', 'error'),
    }
    if (groupDialog.mode === 'create') createGroup.mutate(name, opts)
    else renameGroup.mutate({ id: groupDialog.id, name }, opts)
  }

  function selectSection(ids: number[], allSelected: boolean) {
    setSelectedIds((prev) => {
      const rest = prev.filter((x) => !ids.includes(x))
      return allSelected ? rest : [...rest, ...ids]
    })
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
        <div className="search" style={{ maxWidth: 260 }}>
          <Icon name="search" />
          <input
            value={query}
            placeholder="Snippets durchsuchen…"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="mini-btn" aria-label="Leeren" onClick={() => setQuery('')}>
              <Icon name="close" />
            </button>
          )}
        </div>
        <button
          className="chip"
          data-active={selectMode}
          onClick={() => {
            if (selectMode) setSelectedIds([])
            setSelectMode((v) => !v)
          }}
        >
          <Icon name="library_add_check" /> {selectMode ? 'Auswahl beenden' : 'Auswählen'}
        </button>
        <button className="chip" onClick={() => setGroupDialog({ mode: 'create' })}>
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
                dragDisabled={searching || selectMode}
                synced={
                  sec.groupId != null
                    ? (syncedByGroupId.get(sec.groupId) ?? false)
                    : (syncSettings?.sync_ungrouped ?? false)
                }
                onToggleSync={(next) => {
                  if (sec.groupId != null) {
                    toggleGroupSync.mutate({ id: sec.groupId, synced: next })
                  } else {
                    updateSync.mutate({ sync_ungrouped: next })
                  }
                  toast.show(
                    next
                      ? `„${sec.key === UNGROUPED_KEY ? UNGROUPED_LABEL : sec.name}" wird mit Inspector Rust synchronisiert`
                      : 'Sync für diese Gruppe deaktiviert',
                    'success',
                  )
                }}
                onToggle={() => toggleCollapse(sec.key)}
                onRename={
                  sec.groupId != null
                    ? () => setGroupDialog({ mode: 'rename', id: sec.groupId as number, current: sec.name })
                    : undefined
                }
                onDelete={
                  sec.groupId != null
                    ? () => setConfirmGroup({ id: sec.groupId as number, name: sec.name })
                    : undefined
                }
                selectedIds={selectedIds}
                selectMode={selectMode}
                onToggleSelect={toggleSelect}
                onSelectSection={selectSection}
                onEdit={(s) => setEditing(s)}
                onCopy={(s) => {
                  void copyText(s.body).then((ok) => {
                    vibrate(10)
                    toast.show(ok ? 'Body in Zwischenablage kopiert' : 'Kopieren fehlgeschlagen', ok ? 'success' : 'error')
                  })
                }}
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
          <button className="btn btn--danger" onClick={() => setConfirmBulk(true)}>
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
                    setConfirmSnippet(editing)
                    setEditing(null)
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>

      {groupDialog && (
        <InputDialog
          title={groupDialog.mode === 'create' ? 'Neue Gruppe' : 'Gruppe umbenennen'}
          label="Name der Gruppe"
          placeholder="z. B. AI Prompts"
          icon={groupDialog.mode === 'create' ? 'create_new_folder' : 'edit'}
          initialValue={groupDialog.mode === 'rename' ? groupDialog.current : ''}
          confirmLabel={groupDialog.mode === 'create' ? 'Anlegen' : 'Umbenennen'}
          validate={(name) => {
            const unchanged = groupDialog.mode === 'rename' && name === groupDialog.current
            if (!unchanged && existingGroupNames.has(name.toLowerCase()))
              return 'Gruppe existiert bereits'
            return null
          }}
          onConfirm={submitGroupDialog}
          onCancel={() => setGroupDialog(null)}
        />
      )}

      {confirmSnippet && (
        <Confirm
          title={`Snippet „${confirmSnippet.abbreviation}" löschen?`}
          message="In Inspector Rust bleibt das Snippet bestehen (Merge-Import) und muss dort separat gelöscht werden."
          confirmLabel="Löschen"
          onCancel={() => setConfirmSnippet(null)}
          onConfirm={() => {
            del.mutate(confirmSnippet.id, {
              onSuccess: () => toast.show('Snippet gelöscht', 'success'),
            })
            setConfirmSnippet(null)
          }}
        />
      )}

      {confirmBulk && (
        <Confirm
          title={`${selectedIds.length} Snippets löschen?`}
          message="Gelöschte Snippets bleiben in Inspector Rust bestehen (Merge-Import) und müssen dort separat entfernt werden."
          confirmLabel="Löschen"
          onCancel={() => setConfirmBulk(false)}
          onConfirm={() => {
            bulkDelete.mutate(selectedIds, {
              onSuccess: () => {
                toast.show(`${selectedIds.length} Snippets gelöscht`, 'success')
                setSelectedIds([])
                setSelectMode(false)
              },
            })
            setConfirmBulk(false)
          }}
        />
      )}

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
  dragDisabled,
  synced,
  onToggleSync,
  onToggle,
  onRename,
  onDelete,
  selectedIds,
  selectMode,
  onToggleSelect,
  onSelectSection,
  onEdit,
  onCopy,
}: {
  sectionKey: string
  name: string
  groupId: number | null
  ids: number[]
  byId: Map<number, Snippet>
  collapsed: boolean
  dragDisabled: boolean
  synced: boolean
  onToggleSync: (next: boolean) => void
  onToggle: () => void
  onRename?: () => void
  onDelete?: () => void
  selectedIds: number[]
  selectMode: boolean
  onToggleSelect: (s: Snippet) => void
  onSelectSection: (ids: number[], allSelected: boolean) => void
  onEdit: (s: Snippet) => void
  onCopy: (s: Snippet) => void
}) {
  // The header is sortable (group reorder) when it's a real group.
  const sortable = useSortable({
    id: secId(sectionKey),
    disabled: groupId == null || dragDisabled,
  })
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id))
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
        {selectMode && ids.length > 0 && (
          <button
            className="mini-btn"
            title={allSelected ? 'Gruppe abwählen' : 'Ganze Gruppe auswählen'}
            aria-label="Ganze Gruppe auswählen"
            onClick={() => onSelectSection(ids, allSelected)}
          >
            <Icon name={allSelected ? 'check_box' : 'check_box_outline_blank'} />
          </button>
        )}
        {groupId != null && !dragDisabled && (
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
        <ToggleIconButton
          active={synced}
          onToggle={() => onToggleSync(!synced)}
          iconOn="cloud_sync"
          iconOff="cloud_off"
          labelOn="Sync mit Inspector Rust aktiv — klicken zum Deaktivieren"
          labelOff="Mit Inspector Rust synchronisieren"
          baseClass="sync-btn"
        />
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
                    selectMode={selectMode}
                    dragDisabled={dragDisabled}
                    onToggleSelect={() => onToggleSelect(s)}
                    onEdit={() => onEdit(s)}
                    onCopy={() => onCopy(s)}
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
  selectMode,
  dragDisabled,
  onToggleSelect,
  onEdit,
  onCopy,
}: {
  snippet: Snippet
  selected: boolean
  selectMode: boolean
  dragDisabled: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onCopy: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: snippet.id,
    disabled: dragDisabled,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`snippet-row ${isDragging ? 'dragging' : ''} ${selected ? 'merge-selected' : ''} ${
        selectMode ? 'selecting' : ''
      }`}
      onClick={(e) => {
        if (selectMode || e.metaKey || e.ctrlKey) {
          onToggleSelect()
          return
        }
        onEdit()
      }}
      title={
        selectMode
          ? 'Klick zum Auswählen'
          : 'Klick zum Bearbeiten · Cmd/Ctrl+Klick zum Auswählen · am Griff ziehen zum Verschieben'
      }
    >
      {selectMode ? (
        <Icon
          name={selected ? 'check_box' : 'check_box_outline_blank'}
          className="merge-check-icon"
        />
      ) : (
        !dragDisabled && (
          <span
            className="drag-handle"
            title="Ziehen zum Verschieben"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <Icon name="drag_indicator" />
          </span>
        )
      )}
      <code className="snippet-abbr">{snippet.abbreviation}</code>
      <span className="lt grow">{snippet.title || snippet.body.split('\n')[0]}</span>
      <span className="snippet-version" title={`Version ${snippet.version}`}>
        v{snippet.version}
      </span>
      <button
        className="mini-btn copy-btn"
        aria-label="Body kopieren"
        title="Body in Zwischenablage kopieren"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onCopy()
        }}
      >
        <Icon name="content_copy" />
      </button>
      {!selectMode && selected && <Icon name="check_box" className="proj-menu-check" />}
    </div>
  )
}
