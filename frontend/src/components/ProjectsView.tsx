import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { PRESET_SEEDS, projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import type { Project } from '../lib/types'
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useReorderProjects,
  useUpdateProject,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton } from './ui'
import { Confirm } from './Confirm'

interface RowProps {
  p: Project
  dark: boolean
  editing: Project | null
  setEditing: (p: Project | null) => void
  onSave: (p: Project) => void
  onDelete: (p: Project) => void
}

function ProjectRow({ p, dark, editing, setEditing, onSave, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
  })
  const tones = projectTones(p.color, dark)
  const isEdit = editing?.id === p.id

  return (
    <div
      ref={setNodeRef}
      className={`list-item ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        className="mini-btn drag-handle"
        aria-label="Verschieben"
        title="Ziehen zum Sortieren"
        {...attributes}
        {...listeners}
      >
        <Icon name="drag_indicator" />
      </button>
      <span
        className="dot"
        style={{ background: tones.accent, width: 16, height: 16, borderRadius: '50%' }}
      />
      {isEdit ? (
        <input
          className="input grow"
          value={editing!.name}
          autoFocus
          onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(editing!)
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      ) : (
        <div className="grow">
          <div className="lt">{p.name}</div>
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {p.prompt_count} Prompt{p.prompt_count === 1 ? '' : 's'}
          </div>
        </div>
      )}
      {isEdit ? (
        <>
          {PRESET_SEEDS.slice(0, 6).map((s) => (
            <button
              key={s}
              className="swatch"
              style={{ background: s, width: 24, height: 24 }}
              data-active={editing!.color === s}
              onClick={() => setEditing({ ...editing!, color: s })}
            />
          ))}
          <IconButton icon="check" label="Speichern" onClick={() => onSave(editing!)} />
        </>
      ) : (
        <>
          <IconButton icon="edit" label="Bearbeiten" onClick={() => setEditing(p)} />
          <IconButton icon="delete" label="Löschen" onClick={() => onDelete(p)} />
        </>
      )}
    </div>
  )
}

export function ProjectsView({ dark }: { dark: boolean }) {
  const { data: projects } = useProjects()
  const create = useCreateProject()
  const update = useUpdateProject()
  const del = useDeleteProject()
  const reorder = useReorderProjects()
  const toast = useToast()

  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_SEEDS[0])
  const [editing, setEditing] = useState<Project | null>(null)
  const [confirm, setConfirm] = useState<Project | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  const list = projects ?? []

  async function add() {
    if (!name.trim()) return
    try {
      await create.mutateAsync({ name: name.trim(), color })
      setName('')
      toast.show('Projekt angelegt', 'success')
    } catch {
      toast.show('Name existiert bereits', 'error')
    }
  }

  function save(p: Project) {
    update.mutate({ id: p.id, patch: { name: p.name, color: p.color } })
    setEditing(null)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = list.findIndex((p) => p.id === active.id)
    const to = list.findIndex((p) => p.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(list, from, to)
    reorder.mutate(next.map((p, i) => ({ id: p.id, sort_order: i + 1 })))
  }

  return (
    <div>
      <div className="section">
        <h3>Neues Projekt</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="z. B. inspector-rust"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button icon="add" onClick={add} disabled={!name.trim()}>
            Anlegen
          </Button>
        </div>
        <div className="swatches">
          {PRESET_SEEDS.map((s) => (
            <button
              key={s}
              className="swatch"
              data-active={color === s}
              style={{ background: s }}
              aria-label={s}
              onClick={() => setColor(s)}
            />
          ))}
          <label
            className="swatch"
            style={{ display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <Icon name="palette" />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
            />
          </label>
        </div>
      </div>

      <div className="section">
        <h3>Projekte</h3>
        {list.length === 0 && <p className="muted">Noch keine Projekte.</p>}
        {list.length > 0 && (
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: -4 }}>
            Per <Icon name="drag_indicator" style={{ verticalAlign: '-3px', fontSize: 16 }} /> ziehen
            zum Sortieren — die Reihenfolge gilt auch für die Filter-Chips.
          </p>
        )}
        <motion.div className="list" layout transition={springs.spatial}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={list.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {list.map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  dark={dark}
                  editing={editing}
                  setEditing={setEditing}
                  onSave={save}
                  onDelete={setConfirm}
                />
              ))}
            </SortableContext>
          </DndContext>
        </motion.div>
      </div>

      {confirm && (
        <Confirm
          title={`Projekt „${confirm.name}" löschen?`}
          message={'Zugeordnete Prompts bleiben erhalten und werden auf „Kein Projekt" gesetzt.'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            del.mutate(confirm.id)
            toast.show('Projekt gelöscht', 'success')
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}
