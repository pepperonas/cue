import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import { IS_MAC } from '../lib/platform'
import { api } from '../lib/api'
import type { Attachment, Priority, Project, Prompt, Status } from '../lib/types'
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES } from '../lib/types'
import { useCreatePrompt, usePrompts, useTags, useUpdatePrompt } from '../state/queries'
import { useToast } from '../state/toast'
import {
  dedupeTags,
  mergeSuggestionPool,
  normalizeTags,
  relatedTags,
  type RankContext,
  type TagSuggestion,
} from '../lib/tags'
import { autoTags, deriveTags } from '../lib/tag-rules'
import { buildTitleModel } from '../lib/title-complete'
import { GhostInput } from './GhostInput'
import { useDictation } from '../lib/speech'
import { compressImage } from '../lib/image-compress'
import { formatBytes } from '../lib/format'
import { Button, Icon, IconButton } from './ui'
import { TagInput } from './TagInput'

export const DRAFT_KEY = 'cue-draft'
const LAST_PROJECT_KEY = 'cue-last-project'
const ATTACH_NOTICE_KEY = 'cue-hide-attach-notice'

interface Props {
  projects: Project[]
  editing: Prompt | null
  defaultProjectId: number | null
  /**
   * Created from the bookmarks tab: the prompt is pinned right away and starts
   * WITHOUT a project. Without the flag the user would create something and
   * see nothing, because the tab only lists bookmarks.
   */
  asBookmark?: boolean
  /** Class of the scroll region — the two host sheets name theirs differently. */
  scrollClassName: string
  /** Prefix for field ids, so two instances can never share a `htmlFor`. */
  idPrefix?: string
  /** Icon + label of the secondary header button (close, or back to the view). */
  cancelIcon?: string
  cancelLabel?: string
  /** Discard and leave the editor. */
  onCancel: () => void
  /** Leave the editor after a successful save. */
  onSaved: () => void
  /**
   * Play an entrance. Off inside the composer — that dialog animates itself in
   * as a whole; on when the detail sheet swaps view mode for edit mode, which
   * is the only motion telling the user the surface changed its job.
   */
  animateIn?: boolean
}

/**
 * The prompt form: every field, the save, and the shortcuts around it.
 *
 * It renders THREE direct children (header row, scroll region, action row) and
 * no container of its own, because both hosts are flex columns whose layout
 * rules (`.sheet--x > *`) address direct children — a wrapper here would
 * collapse the scroll region.
 *
 * One definition, two hosts: the composer (creating, and editing straight from
 * a card) and the detail sheet (editing in place, without tearing the dialog
 * down and building a second one).
 */
export function PromptEditor({
  projects,
  editing,
  defaultProjectId,
  asBookmark,
  scrollClassName,
  idPrefix = 'c',
  cancelIcon = 'close',
  cancelLabel = 'Schließen',
  onCancel,
  onSaved,
  animateIn = false,
}: Props) {
  const isEdit = !!editing
  const create = useCreatePrompt()
  const update = useUpdatePrompt()
  const toast = useToast()
  // Suggestion pool: the saved vocabulary (with usage counts, so the ranking
  // can favour what is actually used) plus the curated catalogue behind it.
  const { data: tagData } = useTags()
  const tagSuggestions = useMemo<TagSuggestion[]>(
    () =>
      mergeSuggestionPool(
        (tagData?.items ?? []).map((t) => ({
          name: t.name,
          usage: t.usage_count,
          source: t.source,
          lastUsed: t.last_used_at ? Date.parse(t.last_used_at) : undefined,
        })),
      ),
    [tagData],
  )

  // Completion source for the title: the titles written before. React Query
  // dedupes with the board's own call, so this costs no extra request.
  const { data: prompts } = usePrompts()
  const titleModel = useMemo(
    () => buildTitleModel((prompts ?? []).map((p) => p.title)),
    [prompts],
  )

  const [body, setBody] = useState(
    () => editing?.body ?? localStorage.getItem(DRAFT_KEY) ?? '',
  )
  const [title, setTitle] = useState(editing?.title ?? '')
  const [projectId, setProjectId] = useState<number | null>(() => {
    if (editing) return editing.project_id
    // A bookmark is meant to be project-independent, so it does not inherit the
    // last-used project the way a board prompt does.
    if (asBookmark) return null
    if (defaultProjectId != null) return defaultProjectId
    // Preselect the project used for the last created prompt.
    const raw = localStorage.getItem(LAST_PROJECT_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && projects.some((p) => p.id === n) ? n : null
  })
  const [status, setStatus] = useState<Status>(editing?.status ?? 'queued')
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? 'normal')
  const [tags, setTags] = useState(editing?.tags ?? '')
  // Tags derived from the title fill the field until the user takes it over.
  // Editing counts as taken over from the start: the tags on an existing prompt
  // are its author's decision, and an unrelated edit must not rewrite them.
  const [tagsTouched, setTagsTouched] = useState(isEdit)
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachFieldRef = useRef<HTMLDivElement>(null)

  // Screenshot attachments. Existing ones come from the edited prompt; newly
  // uploaded ones are tracked so they can be cleaned up if the editor is closed.
  const [attachments, setAttachments] = useState<Attachment[]>(editing?.attachments ?? [])
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [showNotice, setShowNotice] = useState(
    () => localStorage.getItem(ATTACH_NOTICE_KEY) !== '1',
  )
  const newIds = useRef<Set<number>>(new Set())
  const removedExisting = useRef<Set<number>>(new Set())
  const savedRef = useRef(false)

  // What the prompt is called drives the tags. The title wins; while it is
  // still empty the first body line stands in for it — that is the text the
  // server would derive the title from anyway.
  const tagSource = useMemo(
    () => (title.trim() ? title : (body.split('\n').find((l) => l.trim()) ?? '')),
    [title, body],
  )
  const derived = useMemo(() => autoTags(tagSource), [tagSource])
  // The field shows exactly what will be saved: the derived tags until the user
  // edits it, their own text from then on. No effect, no state to keep in sync.
  // The trailing ", " is what `commit()` leaves behind after picking a tag too:
  // it puts the field in "ready for the next one" state, so focusing it opens
  // the menu instead of treating the last tag as a half-typed query.
  const effectiveTags = tagsTouched ? tags : derived.length ? `${derived.join(', ')}, ` : ''
  const tagContext = useMemo<RankContext>(
    () => ({
      derived: new Set(deriveTags(tagSource).map((d) => d.tag)),
      related: relatedTags(prompts ?? [], dedupeTags(effectiveTags)),
    }),
    [tagSource, prompts, effectiveTags],
  )

  // Voice dictation (Web Speech API): finalized phrases are appended to the
  // body with smart spacing; interim text shows in a live readout below the
  // textarea. Unsupported browsers (Firefox) simply don't render the button.
  const dictation = useDictation(
    (text) => {
      if (!text) return
      setBody((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${text}` : prev + text))
    },
    (error) => {
      toast.show(
        error === 'not-allowed' || error === 'service-not-allowed'
          ? 'Mikrofon-Zugriff verweigert'
          : 'Diktat fehlgeschlagen',
        'error',
      )
    },
  )

  // Focus the editor on open and whenever preview switches back to edit mode
  // (e.g. via double-click on the preview).
  useEffect(() => {
    if (!preview) taRef.current?.focus()
  }, [preview])

  // The mic chip lives next to the textarea — switching to preview hides it,
  // so an active recording must not keep running invisibly.
  useEffect(() => {
    if (preview) dictation.stop()
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  // Delete still-uncommitted uploads if the editor closes without saving.
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
    // The screenshots field is the LAST one in the dialog, so pasting into the
    // prompt text used to change nothing anywhere near the cursor — the upload
    // worked and looked like it had not. Bring the field into view and say so.
    revealAttachments()
    let added = 0
    let bytes = 0
    for (const file of images) {
      try {
        const att = await api.uploadAttachment(await compressImage(file))
        newIds.current.add(att.id)
        setAttachments((prev) => [...prev, att])
        added += 1
        bytes += att.size
      } catch {
        toast.show('Bild-Upload fehlgeschlagen', 'error')
      } finally {
        setUploading((n) => n - 1)
      }
    }
    if (added) {
      toast.show(
        added === 1
          ? `Screenshot hinzugefügt · ${formatBytes(bytes)}`
          : `${added} Screenshots hinzugefügt · ${formatBytes(bytes)}`,
        'success',
      )
    }
  }

  /** Scroll the screenshots field just far enough to be visible. `nearest`
   *  keeps the movement minimal, so pasting mid-sentence does not throw the
   *  text out of view. */
  function revealAttachments() {
    requestAnimationFrame(() => {
      attachFieldRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  function removeAttachment(att: Attachment) {
    setAttachments((prev) => prev.filter((a) => a.id !== att.id))
    if (newIds.current.has(att.id)) {
      // Uncommitted upload from this session — safe to drop immediately.
      newIds.current.delete(att.id)
      void api.deleteAttachment(att.id).catch(() => {})
    } else {
      // Already persisted on the prompt: stage the removal so "Abbrechen"
      // leaves it intact; only delete on a successful save.
      removedExisting.current.add(att.id)
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
    if (!body.trim()) {
      // Never fail silently: Cmd+Enter with an empty body used to do nothing,
      // which reads as "the shortcut is broken".
      toast.show('Prompt-Text fehlt', 'error')
      setPreview(false)
      taRef.current?.focus()
      return
    }
    const attachment_ids = attachments.map((a) => a.id)
    const cleanTags = normalizeTags(effectiveTags) // dedup so a prompt never holds a tag twice
    // Accepting a completion leaves a trailing space behind the caret.
    const cleanTitle = title.trim()
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            body,
            title: cleanTitle,
            status,
            priority,
            tags: cleanTags,
            project_id: projectId,
            unassign_project: projectId === null,
            attachment_ids,
          },
        })
        toast.show('Gespeichert', 'success')
      } else {
        await create.mutateAsync({
          body,
          title: cleanTitle || undefined,
          project_id: projectId,
          status,
          priority,
          tags: cleanTags,
          attachment_ids,
          bookmarked: asBookmark || undefined,
        })
        localStorage.removeItem(DRAFT_KEY)
        // Remember the project so the next new prompt preselects it — but not
        // from the bookmarks tab: a deliberately project-less bookmark must not
        // wipe the board's preselection.
        if (!asBookmark) {
          localStorage.setItem(LAST_PROJECT_KEY, projectId == null ? '' : String(projectId))
        }
        toast.show(asBookmark ? 'Bookmark angelegt' : 'Prompt angelegt', 'success')
      }
      savedRef.current = true // keep the now-associated uploads
      // Now that the save succeeded, actually delete the removed existing ones.
      removedExisting.current.forEach((id) => {
        void api.deleteAttachment(id).catch(() => {})
      })
      removedExisting.current.clear()
      onSaved()
    } catch {
      toast.show('Speichern fehlgeschlagen', 'error')
    }
  }

  // Cmd/Ctrl+Enter and Cmd/Ctrl+S save regardless of where the focus sits.
  // A window-level CAPTURE listener is required: clicking a non-focusable area
  // (e.g. the rendered preview) moves focus to <body>, where a keydown handler
  // on the sheet element would never fire. The host sheet keeps a bubble-phase
  // backup handler.
  //
  // Capture and backup coordinate through a WeakSet of handled events — NOT
  // through defaultPrevented: a browser extension (or any listener registered
  // before ours) that preventDefaults the combo would otherwise silently
  // disable saving entirely. Cmd/Ctrl+S exists as a second, muscle-memory
  // path for setups where something outside the page swallows Cmd+Enter.
  const saveRef = useRef(save)
  saveRef.current = save
  const uploadRef = useRef(uploadFiles)
  uploadRef.current = uploadFiles
  const savingRef = useRef(false)
  const handledSaveKeys = useRef(new WeakSet<KeyboardEvent>())
  function isSaveCombo(e: { metaKey: boolean; ctrlKey: boolean; key: string }) {
    return (e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')
  }
  async function triggerSave() {
    if (savingRef.current) return // no double-create while a save is in flight
    savingRef.current = true
    try {
      await saveRef.current()
    } finally {
      savingRef.current = false
    }
  }
  function handleSaveKey(e: KeyboardEvent) {
    if (!isSaveCombo(e) || handledSaveKeys.current.has(e)) return
    handledSaveKeys.current.add(e)
    e.preventDefault() // also suppresses the browser's save-page dialog on Cmd/Ctrl+S
    void triggerSave()
  }
  const handleSaveKeyRef = useRef(handleSaveKey)
  handleSaveKeyRef.current = handleSaveKey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleSaveKeyRef.current(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Pasting a screenshot works anywhere in the dialog. This has to be a WINDOW
  // listener, not one on an element: clicking the rendered preview moves focus
  // to `<body>`, and a paste then targets body — which is not inside the sheet,
  // so no handler down here would ever see it.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f && f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void uploadRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  /** Entrance of one of the three parts, staggered so the surface reads as
   *  reconfiguring itself rather than three things appearing at once. */
  const enter = (step: number) =>
    animateIn && !prefersReducedMotion()
      ? {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { ...springs.spatialFast, delay: step * 0.045 },
        }
      : {}

  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <>
      <motion.div className="row" style={{ justifyContent: 'space-between' }} {...enter(0)}>
        <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>
          {isEdit ? 'Prompt bearbeiten' : asBookmark ? 'Neues Bookmark' : 'Neuer Prompt'}
        </h2>
        <div className="row">
          <IconButton
            icon={preview ? 'edit' : 'visibility'}
            label={preview ? 'Bearbeiten' : 'Vorschau'}
            onClick={() => setPreview((v) => !v)}
          />
          <IconButton icon={cancelIcon} label={cancelLabel} onClick={onCancel} />
        </div>
      </motion.div>

      {/* The form area is also the drop zone. It cannot be the sheet itself:
          the editor renders into a host it does not own. Dropping onto the
          dashed outline is if anything clearer than "somewhere in the dialog". */}
      <motion.div
        className={`${scrollClassName} prompt-form${dragOver ? ' drag-over' : ''}`}
        onKeyDown={(e) => {
          // Bubble-phase backup for the window CAPTURE listener above; the
          // WeakSet in handleSaveKey makes a double-save impossible.
          handleSaveKeyRef.current(e.nativeEvent)
        }}
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
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer?.files?.length) void uploadFiles(Array.from(e.dataTransfer.files))
        }}
        {...enter(1)}
      >
        <div className="field">
          <label htmlFor={id('title')}>Titel (optional)</label>
          <GhostInput
            id={id('title')}
            value={title}
            model={titleModel}
            placeholder="Aus erster Zeile abgeleitet, wenn leer"
            onChange={setTitle}
          />
        </div>

        {preview ? (
          <div
            ref={previewRef}
            className="md-preview"
            title="Doppelklick zum Bearbeiten"
            style={{
              minHeight: 240,
              background: 'var(--md-surface-container-lowest)',
              borderRadius: 'var(--shape-s)',
              padding: 'var(--gap-4)',
              userSelect: 'text',
              cursor: 'text',
            }}
            onDoubleClick={() => setPreview(false)}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Nichts zum Anzeigen_') }}
          />
        ) : (
          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label htmlFor={id('body')} style={{ margin: 0 }}>
                Prompt (Markdown)
              </label>
              {dictation.supported && (
                <button
                  className={`chip ${dictation.listening ? 'dictating' : ''}`}
                  onClick={dictation.toggle}
                  title={dictation.listening ? 'Aufnahme stoppen' : 'Prompt diktieren'}
                >
                  <Icon name={dictation.listening ? 'stop_circle' : 'mic'} />{' '}
                  {dictation.listening ? 'Stoppen' : 'Diktieren'}
                </button>
              )}
            </div>
            <textarea
              id={id('body')}
              ref={taRef}
              className="textarea"
              value={body}
              placeholder="Schreibe deinen Claude-Code-Prompt…"
              onChange={(e) => setBody(e.target.value)}
            />
            {dictation.listening && (
              <div className="dictation-live" aria-live="polite">
                <span className="dictation-dot" />
                <span className="dictation-text">{dictation.interim || 'Zuhören…'}</span>
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor={id('project')}>Projekt</label>
            <select
              id={id('project')}
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
            <label htmlFor={id('status')}>Status</label>
            <select
              id={id('status')}
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
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor={id('priority')}>Priorität</label>
            <select
              id={id('priority')}
              className="select"
              data-prio={priority}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {/* Urgent first — the list reads top-down like the queue it orders. */}
              {PRIORITIES.map((level) => (
                <option key={level} value={level}>
                  {PRIORITY_LABEL[level]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor={id('tags')}>Tags (kommagetrennt)</label>
          <TagInput
            id={id('tags')}
            value={effectiveTags}
            placeholder="refactor, bug, idea"
            suggestions={tagSuggestions}
            context={tagContext}
            onChange={(v) => {
              setTagsTouched(true)
              setTags(v)
            }}
          />
          {!tagsTouched && derived.length > 0 && (
            <div className="auto-tags" aria-live="polite">
              <Icon name="auto_awesome" />
              <span>Aus dem Titel ergänzt: {derived.map((t) => `#${t}`).join(', ')}</span>
              <button
                className="link-btn"
                onClick={() => {
                  setTagsTouched(true)
                  setTags('')
                }}
              >
                Entfernen
              </button>
            </div>
          )}
        </div>

        <div className="field" ref={attachFieldRef}>
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
          {showNotice && (
            <div className="attach-notice">
              <Icon name="schedule" />
              <span>Screenshots werden nach 30 Tagen automatisch gelöscht.</span>
              <button
                className="link-btn"
                onClick={() => {
                  localStorage.setItem(ATTACH_NOTICE_KEY, '1')
                  setShowNotice(false)
                }}
              >
                Nicht wieder anzeigen
              </button>
            </div>
          )}
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
      </motion.div>

      <motion.div className="row-end" {...enter(2)}>
        <Button variant="text" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button icon="check" onClick={() => void triggerSave()} disabled={!body.trim()}>
          {isEdit ? 'Speichern' : 'Anlegen'}{' '}
          <kbd style={{ marginLeft: 6 }} title={IS_MAC ? 'Cmd+Enter' : 'Strg+Enter'}>
            {IS_MAC ? <Icon name="keyboard_command_key" /> : 'Strg'} ↵
          </kbd>
        </Button>
      </motion.div>
    </>
  )
}
