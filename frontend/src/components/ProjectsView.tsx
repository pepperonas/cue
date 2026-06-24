import { useState } from 'react'
import { motion } from 'motion/react'
import { PRESET_SEEDS, projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import type { Project } from '../lib/types'
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton } from './ui'
import { Confirm } from './Confirm'

export function ProjectsView({ dark }: { dark: boolean }) {
  const { data: projects } = useProjects()
  const create = useCreateProject()
  const update = useUpdateProject()
  const del = useDeleteProject()
  const toast = useToast()

  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_SEEDS[0])
  const [editing, setEditing] = useState<Project | null>(null)
  const [confirm, setConfirm] = useState<Project | null>(null)

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
        {(projects ?? []).length === 0 && <p className="muted">Noch keine Projekte.</p>}
        <div className="list">
          {(projects ?? []).map((p) => {
            const tones = projectTones(p.color, dark)
            const isEdit = editing?.id === p.id
            return (
              <motion.div key={p.id} className="list-item" layout transition={springs.spatial}>
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
                      if (e.key === 'Enter') {
                        update.mutate({ id: p.id, patch: { name: editing!.name, color: editing!.color } })
                        setEditing(null)
                      }
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
                    <IconButton
                      icon="check"
                      label="Speichern"
                      onClick={() => {
                        update.mutate({ id: p.id, patch: { name: editing!.name, color: editing!.color } })
                        setEditing(null)
                      }}
                    />
                  </>
                ) : (
                  <>
                    <IconButton icon="edit" label="Bearbeiten" onClick={() => setEditing(p)} />
                    <IconButton icon="delete" label="Löschen" onClick={() => setConfirm(p)} />
                  </>
                )}
              </motion.div>
            )
          })}
        </div>
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
