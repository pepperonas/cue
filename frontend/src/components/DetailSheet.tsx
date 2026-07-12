import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL, STATUSES } from '../lib/types'
import { BlockedButton } from './BlockedButton'
import { BookmarkButton } from './BookmarkButton'
import { TestedButton } from './TestedButton'
import { Button, Icon, IconButton } from './ui'

interface Props {
  prompt: Prompt
  project?: Project
  projects: Project[]
  dark: boolean
  onClose: () => void
  onCopy: (p: Prompt) => void
  onEdit: (p: Prompt) => void
  onDelete: (p: Prompt) => void
  onStatus: (p: Prompt, s: Status) => void
  onToggleBookmark: (p: Prompt) => void
  onToggleTested: (p: Prompt) => void
  onToggleBlocked: (p: Prompt) => void
  onMoveProject: (p: Prompt, projectId: number | null) => void
  onCopyToProject: (p: Prompt, projectId: number | null) => void
  onRun?: (p: Prompt) => void
  onSend?: (p: Prompt) => void
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function DetailSheet({
  prompt,
  project,
  projects,
  dark,
  onClose,
  onCopy,
  onEdit,
  onDelete,
  onStatus,
  onToggleBookmark,
  onToggleTested,
  onToggleBlocked,
  onMoveProject,
  onCopyToProject,
  onRun,
  onSend,
}: Props) {
  const [showRaw, setShowRaw] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [projMenu, setProjMenu] = useState(false)
  const [projMode, setProjMode] = useState<'move' | 'copy'>('move')
  const projWrapRef = useRef<HTMLSpanElement>(null)
  const canTest = prompt.status === 'running' || prompt.status === 'done'
  const canBlock = prompt.status === 'queued'
  const tones = project ? projectTones(project.color, dark) : null
  const contentRef = useRef<HTMLDivElement>(null)

  // Project menu: close on outside click; Escape closes just the menu (captured
  // before the global handler would close the whole sheet).
  useEffect(() => {
    if (!projMenu) return
    function onDown(e: PointerEvent) {
      if (projWrapRef.current && !projWrapRef.current.contains(e.target as Node)) {
        setProjMenu(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setProjMenu(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onEsc, true)
    }
  }, [projMenu])

  function chooseProject(projectId: number | null) {
    setProjMenu(false)
    const current = prompt.project_id ?? null
    if (projMode === 'move') {
      if (projectId !== current) onMoveProject(prompt, projectId)
    } else {
      onCopyToProject(prompt, projectId)
    }
  }

  // Cmd/Ctrl+A selects only the prompt content (not the whole page behind the
  // sheet), so a following Cmd/Ctrl+C copies just the prompt.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'a') {
        const node = contentRef.current
        const sel = window.getSelection()
        if (!node || !sel) return
        e.preventDefault()
        const range = document.createRange()
        range.selectNodeContents(node)
        sel.removeAllRanges()
        sel.addRange(range)
      } else if (key === 'c') {
        // Direct Cmd/Ctrl+C with no active selection copies the whole prompt.
        const sel = window.getSelection()
        if (sel && sel.toString().length > 0) return
        e.preventDefault()
        onCopy(prompt)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCopy, prompt])

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        layoutId={`card-${prompt.id}`}
        className="sheet sheet--detail"
        onClick={(e) => e.stopPropagation()}
        transition={springs.spatial}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 style={{ margin: 0 }}>{prompt.title || 'Untitled'}</h2>
          <div className="row">
            {canTest && (
              <TestedButton
                variant="icon-btn"
                tested={prompt.tested}
                onToggle={() => onToggleTested(prompt)}
              />
            )}
            {canBlock && (
              <BlockedButton
                variant="icon-btn"
                blocked={prompt.blocked}
                onToggle={() => onToggleBlocked(prompt)}
              />
            )}
            <BookmarkButton
              variant="icon-btn"
              bookmarked={prompt.bookmarked}
              onToggle={() => onToggleBookmark(prompt)}
            />
            <IconButton icon="close" label="Schließen" onClick={onClose} />
          </div>
        </div>

        <div className="card-meta">
          <span ref={projWrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              className="badge badge-btn"
              style={
                project && tones
                  ? { background: tones.container, color: tones.on }
                  : { background: 'var(--md-surface-container-highest)' }
              }
              title="Projekt ändern oder Prompt in anderes Projekt kopieren"
              onClick={() => setProjMenu((v) => !v)}
            >
              <span
                className="dot"
                style={{ background: tones ? tones.accent : 'var(--md-outline)' }}
              />
              {project ? project.name : 'Kein Projekt'}
              <Icon name={projMenu ? 'expand_less' : 'expand_more'} className="badge-caret" />
            </button>
            {projMenu && (
              <motion.div
                className="proj-menu"
                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={springs.spatialFast}
              >
                <div className="proj-menu-modes">
                  <button
                    className="chip"
                    data-active={projMode === 'move'}
                    onClick={() => setProjMode('move')}
                  >
                    <Icon name="drive_file_move" /> Verschieben
                  </button>
                  <button
                    className="chip"
                    data-active={projMode === 'copy'}
                    onClick={() => setProjMode('copy')}
                  >
                    <Icon name="content_copy" /> Kopieren
                  </button>
                </div>
                <div className="proj-menu-list">
                  <button className="proj-menu-item" onClick={() => chooseProject(null)}>
                    <span className="dot" style={{ background: 'var(--md-outline)' }} />
                    Kein Projekt
                    {prompt.project_id == null && projMode === 'move' && (
                      <Icon name="check" className="proj-menu-check" />
                    )}
                  </button>
                  {projects.map((pr) => (
                    <button
                      key={pr.id}
                      className="proj-menu-item"
                      onClick={() => chooseProject(pr.id)}
                    >
                      <span className="dot" style={{ background: pr.color }} />
                      {pr.name}
                      {prompt.project_id === pr.id && projMode === 'move' && (
                        <Icon name="check" className="proj-menu-check" />
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </span>
          <span className="badge" style={{ background: 'var(--md-surface-container-highest)' }}>
            <Icon
              name={STATUS_ICON[prompt.status]}
              className={`st-icon ${STATUS_CLASS[prompt.status]}`}
            />{' '}
            {STATUS_LABEL[prompt.status]}
          </span>
        </div>

        <div className="row" style={{ gap: 'var(--gap-2)', flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              className="chip"
              data-active={prompt.status === s}
              disabled={prompt.blocked && (s === 'running' || s === 'done')}
              title={
                prompt.blocked && (s === 'running' || s === 'done')
                  ? 'Blockiert — erst Blockierung aufheben'
                  : undefined
              }
              onClick={() => onStatus(prompt, s)}
            >
              <Icon name={STATUS_ICON[s]} className={`st-icon ${STATUS_CLASS[s]}`} /> {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <Button
          variant="filled"
          icon="content_copy"
          onClick={() => onCopy(prompt)}
          style={{ height: 56, flexShrink: 0, fontSize: '1rem' }}
        >
          In Zwischenablage kopieren
        </Button>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Inhalt</span>
          <button className="chip" onClick={() => setShowRaw((v) => !v)}>
            <Icon name={showRaw ? 'visibility' : 'code'} /> {showRaw ? 'Vorschau' : 'Rohtext'}
          </button>
        </div>

        <div className="detail-scroll">
          <div
            ref={contentRef}
            style={{ userSelect: 'text', cursor: 'text' }}
            title="Doppelklick zum Bearbeiten"
            onDoubleClick={() => onEdit(prompt)}
          >
            {showRaw ? (
            <pre
              style={{
                background: 'var(--md-surface-container-lowest)',
                padding: 'var(--gap-4)',
                borderRadius: 'var(--shape-s)',
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              {prompt.body}
            </pre>
          ) : (
            <div
              className="md-preview"
              style={{
                background: 'var(--md-surface-container-lowest)',
                padding: 'var(--gap-4)',
                borderRadius: 'var(--shape-s)',
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(prompt.body) }}
            />
          )}
        </div>

          {prompt.attachments.length > 0 && (
            <div>
              <span className="muted">Screenshots</span>
              <div className="attach-grid" style={{ marginTop: 'var(--gap-2)' }}>
                {prompt.attachments.map((a) => (
                  <button
                    className="attach-thumb attach-view"
                    key={a.id}
                    onClick={() => setLightbox(a.url)}
                    title={a.name}
                  >
                    <img src={a.url} alt={a.name} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.8 }}>
            <div>Erstellt: {fmt(prompt.created_at)}</div>
            <div>Aktualisiert: {fmt(prompt.updated_at)}</div>
            <div>Gestartet: {fmt(prompt.ran_at)}</div>
          </div>
        </div>

        <div className="row-end">
          <Button variant="danger" icon="delete" onClick={() => onDelete(prompt)}>
            Löschen
          </Button>
          {onRun && !prompt.blocked && (
            <Button variant="tonal" icon="play_arrow" onClick={() => onRun(prompt)}>
              Ausführen
            </Button>
          )}
          {onSend && (
            <Button variant="tonal" icon="send" onClick={() => onSend(prompt)}>
              An CLI senden
            </Button>
          )}
          <Button variant="tonal" icon="edit" onClick={() => onEdit(prompt)}>
            Bearbeiten
          </Button>
        </div>
      </motion.div>

      {lightbox && (
        <div
          className="lightbox"
          onClick={(e) => {
            e.stopPropagation()
            setLightbox(null)
          }}
        >
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  )
}
