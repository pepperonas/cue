import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import { api } from '../lib/api'
import type { Attachment, Project, Prompt, Status } from '../lib/types'
import { STATUS_LABEL, STATUSES } from '../lib/types'
import { useCreatePrompt, usePrompts, useUpdatePrompt } from '../state/queries'
import { useToast } from '../state/toast'
import { DEV_TAGS } from '../lib/tags'
import { Button, Icon, IconButton } from './ui'
import { TagInput } from './TagInput'

const DRAFT_KEY = 'cue-draft'
const LAST_PROJECT_KEY = 'cue-last-project'

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
  const { data: allPrompts } = usePrompts()

  // Suggestion pool: tags already used across prompts first (most relevant),
  // then the curated English dev-tag list — deduped, case-insensitive.
  const tagSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const push = (raw: string) => {
      const t = raw.trim()
      const key = t.toLowerCase()
      if (t && !seen.has(key)) {
        seen.add(key)
        out.push(t)
      }
    }
    for (const p of allPrompts ?? []) {
      for (const t of (p.tags ?? '').split(',')) push(t)
    }
    for (const t of DEV_TAGS) push(t)
    return out
  }, [allPrompts])

  const [body, setBody] = useState(
    () => editing?.body ?? localStorage.getItem(DRAFT_KEY) ?? '',
  )
  const [title, setTitle] = useState(editing?.title ?? '')
  const [projectId, setProjectId] = useState<number | null>(() => {
    if (editing) return editing.project_id
    if (defaultProjectId != null) return defaultProjectId
    // Preselect the project used for the last created prompt.
    const raw = localStorage.getItem(LAST_PROJECT_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && projects.some((p) => p.id === n) ? n : null
  })
  const [status, setStatus] = useState<Status>(editing?.status ?? 'queued')
  const [tags, setTags] = useState(editing?.tags ?? '')
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Screenshot attachments. Existing ones come from the edited prompt; newly
  // uploaded ones are tracked so they can be cleaned up if the dialog is cancelled.
  const [attachments, setAttachments] = useState<Attachment[]>(editing?.attachments ?? [])
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const newIds = useRef<Set<number>>(new Set())
  const savedRef = useRef(false)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  // Delete still-uncommitted uploads if the composer closes without saving.
  useEffect(() => {
    return () => {
      if (savedRef.current) return
      newIds.current.forEach((id) => {
        void api.deleteAttachment(id).catch(() => {})
      })
    }
  }, [])

  async function uploadFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    setUploading((n) => n + images.length)
    for (const file of images) {
      try {
        const att = await api.uploadAttachment(file)
        newIds.current.add(att.id)
        setAttachments((prev) => [...prev, att])
      } catch {
        toast.show('Bild-Upload fehlgeschlagen', 'error')
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  function removeAttachment(att: Attachment) {
    setAttachments((prev) => prev.filter((a) => a.id !== att.id))
    newIds.current.delete(att.id)
    void api.deleteAttachment(att.id).catch(() => {})
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) void uploadFiles(Array.from(e.dataTransfer.files))
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f && f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      void uploadFiles(files)
    }
  }

  // In read-only preview, Cmd/Ctrl+A selects only the rendered prompt (not the
  // page behind the sheet). In edit mode the textarea handles select-all itself.
  useEffect(() => {
    if (!preview) return
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return
      const node = previewRef.current
      const sel = window.getSelection()
      if (!node || !sel) return
      e.preventDefault()
      const range = document.createRange()
      range.selectNodeContents(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  // Autosave draft (new prompts only).
  useEffect(() => {
    if (!isEdit) localStorage.setItem(DRAFT_KEY, body)
  }, [body, isEdit])

  async function save() {
    if (!body.trim()) return
    const attachment_ids = attachments.map((a) => a.id)
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
            attachment_ids,
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
          attachment_ids,
        })
        localStorage.removeItem(DRAFT_KEY)
        // Remember the project so the next new prompt preselects it.
        localStorage.setItem(LAST_PROJECT_KEY, projectId == null ? '' : String(projectId))
        toast.show('Prompt angelegt', 'success')
      }
      savedRef.current = true // keep the now-associated uploads
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
        className={`sheet ${dragOver ? 'drag-over' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false)
        }}
        onDrop={onDrop}
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
            ref={previewRef}
            className="md-preview"
            style={{
              minHeight: 240,
              background: 'var(--md-surface-container-lowest)',
              borderRadius: 'var(--shape-s)',
              padding: 'var(--gap-4)',
              userSelect: 'text',
              cursor: 'text',
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
          <TagInput
            id="c-tags"
            value={tags}
            placeholder="refactor, bug, idea"
            suggestions={tagSuggestions}
            onChange={setTags}
          />
        </div>

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label style={{ margin: 0 }}>Screenshots</label>
            <button className="chip" onClick={() => fileRef.current?.click()}>
              <Icon name="add_photo_alternate" /> Bild hinzufügen
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void uploadFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
          {attachments.length === 0 && uploading === 0 ? (
            <div className="dropzone-hint muted">
              <Icon name="image" /> Screenshots hierher ziehen oder einfügen (Cmd/Ctrl+V)
            </div>
          ) : (
            <div className="attach-grid">
              {attachments.map((a) => (
                <div className="attach-thumb" key={a.id}>
                  <img src={a.url} alt={a.name} loading="lazy" />
                  <button
                    className="attach-remove"
                    aria-label="Entfernen"
                    title="Entfernen"
                    onClick={() => removeAttachment(a)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <div className="attach-thumb attach-loading">
                  <Icon name="progress_activity" className="spin" />
                </div>
              )}
            </div>
          )}
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
