import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_LABEL, STATUSES } from '../lib/types'
import { useCreatePrompt, useUpdatePrompt } from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton } from './ui'

const DRAFT_KEY = 'cue-draft'

interface Props {
  projects: Project[]
  editing: Prompt | null
  defaultProjectId: number | null
  onClose: () => void
}

export function Composer({ projects, editing, defaultProjectId, onClose }: Props) {
  const isEdit = !!editing
  const create = useCreatePrompt()
  const update = useUpdatePrompt()
  const toast = useToast()

  const [body, setBody] = useState(
    () => editing?.body ?? localStorage.getItem(DRAFT_KEY) ?? '',
  )
  const [title, setTitle] = useState(editing?.title ?? '')
  const [projectId, setProjectId] = useState<number | null>(
    editing?.project_id ?? defaultProjectId,
  )
  const [status, setStatus] = useState<Status>(editing?.status ?? 'queued')
  const [tags, setTags] = useState(editing?.tags ?? '')
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  // Autosave draft (new prompts only).
  useEffect(() => {
    if (!isEdit) localStorage.setItem(DRAFT_KEY, body)
  }, [body, isEdit])

  async function save() {
    if (!body.trim()) return
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            body,
            title,
            status,
            tags,
            project_id: projectId,
            unassign_project: projectId === null,
          },
        })
        toast.show('Gespeichert', 'success')
      } else {
        await create.mutateAsync({
          body,
          title: title || undefined,
          project_id: projectId,
          status,
          tags,
        })
        localStorage.removeItem(DRAFT_KEY)
        toast.show('Prompt angelegt', 'success')
      }
      onClose()
    } catch {
      toast.show('Speichern fehlgeschlagen', 'error')
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        layoutId="composer-surface"
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        transition={springs.spatial}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>
            {isEdit ? 'Prompt bearbeiten' : 'Neuer Prompt'}
          </h2>
          <div className="row">
            <IconButton
              icon={preview ? 'edit' : 'visibility'}
              label={preview ? 'Bearbeiten' : 'Vorschau'}
              onClick={() => setPreview((v) => !v)}
            />
            <IconButton icon="close" label="Schließen" onClick={onClose} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="c-title">Titel (optional)</label>
          <input
            id="c-title"
            className="input"
            value={title}
            placeholder="Aus erster Zeile abgeleitet, wenn leer"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {preview ? (
          <div
            className="md-preview"
            style={{
              minHeight: 240,
              background: 'var(--md-surface-container-lowest)',
              borderRadius: 'var(--shape-s)',
              padding: 'var(--gap-4)',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Nichts zum Anzeigen_') }}
          />
        ) : (
          <div className="field">
            <label htmlFor="c-body">Prompt (Markdown)</label>
            <textarea
              id="c-body"
              ref={taRef}
              className="textarea"
              value={body}
              placeholder="Schreibe deinen Claude-Code-Prompt…"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        )}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="c-project">Projekt</label>
            <select
              id="c-project"
              className="select"
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Kein Projekt —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="c-status">Status</label>
            <select
              id="c-status"
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="c-tags">Tags (kommagetrennt)</label>
          <input
            id="c-tags"
            className="input"
            value={tags}
            placeholder="refactor, bug, idee"
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="check" onClick={save} disabled={!body.trim()}>
            {isEdit ? 'Speichern' : 'Anlegen'}{' '}
            <kbd style={{ marginLeft: 6 }}>
              <Icon name="keyboard_command_key" /> ↵
            </kbd>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
