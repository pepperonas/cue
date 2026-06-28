import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL, STATUSES } from '../lib/types'
import { BookmarkButton } from './BookmarkButton'
import { TestedButton } from './TestedButton'
import { Button, Icon, IconButton } from './ui'

interface Props {
  prompt: Prompt
  project?: Project
  dark: boolean
  onClose: () => void
  onCopy: (p: Prompt) => void
  onEdit: (p: Prompt) => void
  onDelete: (p: Prompt) => void
  onStatus: (p: Prompt, s: Status) => void
  onToggleBookmark: (p: Prompt) => void
  onToggleTested: (p: Prompt) => void
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
  dark,
  onClose,
  onCopy,
  onEdit,
  onDelete,
  onStatus,
  onToggleBookmark,
  onToggleTested,
}: Props) {
  const [showRaw, setShowRaw] = useState(false)
  const canTest = prompt.status === 'running' || prompt.status === 'done'
  const tones = project ? projectTones(project.color, dark) : null
  const contentRef = useRef<HTMLDivElement>(null)

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
        className="sheet"
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
            <BookmarkButton
              variant="icon-btn"
              bookmarked={prompt.bookmarked}
              onToggle={() => onToggleBookmark(prompt)}
            />
            <IconButton icon="close" label="Schließen" onClick={onClose} />
          </div>
        </div>

        <div className="card-meta">
          {project && tones && (
            <span className="badge" style={{ background: tones.container, color: tones.on }}>
              <span className="dot" style={{ background: tones.accent }} />
              {project.name}
            </span>
          )}
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

        <div ref={contentRef} style={{ userSelect: 'text', cursor: 'text' }}>
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

        <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.8 }}>
          <div>Erstellt: {fmt(prompt.created_at)}</div>
          <div>Aktualisiert: {fmt(prompt.updated_at)}</div>
          <div>Gestartet: {fmt(prompt.ran_at)}</div>
        </div>

        <div className="row-end">
          <Button variant="danger" icon="delete" onClick={() => onDelete(prompt)}>
            Löschen
          </Button>
          <Button variant="tonal" icon="edit" onClick={() => onEdit(prompt)}>
            Bearbeiten
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
