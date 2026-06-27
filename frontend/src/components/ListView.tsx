import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { emphasized, prefersReducedMotion, springs } from '../lib/motion'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { BookmarkButton } from './BookmarkButton'
import { Icon } from './ui'

interface Props {
  prompts: Prompt[]
  projects: Map<number, Project>
  columns: Status[]
  dark: boolean
  selectedId: number | null
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
}

const COLLAPSE_KEY = 'cue-list-collapsed'

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function ListView({
  prompts,
  projects,
  columns,
  dark,
  selectedId,
  onOpen,
  onCopy,
  onToggleBookmark,
}: Props) {
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed)

  function toggle(status: Status) {
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="list-groups">
      {columns.map((status) => {
        const items = prompts
          .filter((p) => p.status === status)
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        const isCollapsed = collapsed.includes(status)
        return (
          <section className="list-group" key={status}>
            <button
              className="list-group-head"
              onClick={() => toggle(status)}
              aria-expanded={!isCollapsed}
            >
              <Icon
                name="chevron_right"
                className={`list-chevron ${isCollapsed ? '' : 'open'}`}
              />
              <Icon name={STATUS_ICON[status]} className={`st-icon ${STATUS_CLASS[status]}`} />
              <span className="list-group-label">{STATUS_LABEL[status]}</span>
              <span className="count">{items.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={prefersReducedMotion() ? { duration: 0 } : emphasized}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="list">
                    {items.length === 0 ? (
                      <div className="muted list-group-empty">Leer</div>
                    ) : (
                      items.map((p, i) => (
                        <ListRow
                          key={p.id}
                          prompt={p}
                          project={p.project_id ? projects.get(p.project_id) : undefined}
                          dark={dark}
                          index={i}
                          selected={selectedId === p.id}
                          onOpen={onOpen}
                          onCopy={onCopy}
                          onToggleBookmark={onToggleBookmark}
                        />
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )
      })}
    </div>
  )
}

interface RowProps {
  prompt: Prompt
  project?: Project
  dark: boolean
  index: number
  selected: boolean
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
}

function ListRow({
  prompt: p,
  project,
  dark,
  index: i,
  selected,
  onOpen,
  onCopy,
  onToggleBookmark,
}: RowProps) {
  const tones = project ? projectTones(project.color, dark) : null

  // Single click opens; double click copies (see PromptCard for rationale).
  const clickTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current)
    },
    [],
  )
  function handleClick() {
    if (clickTimer.current) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      onOpen(p)
    }, 200)
  }
  function handleDoubleClick() {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    onCopy(p)
  }

  return (
    <motion.div
      className={`list-item ${selected ? 'selected' : ''}`}
      data-prompt-id={p.id}
      title="Doppelklick kopiert den Prompt"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.spatial, delay: Math.min(i * 0.02, 0.2) }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={selected ? { outline: '2px solid var(--md-primary)' } : undefined}
    >
      <Icon name={STATUS_ICON[p.status]} className={`st-icon ${STATUS_CLASS[p.status]}`} />
      <div className="grow">
        <div className="lt">{p.title || 'Untitled'}</div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {STATUS_LABEL[p.status]}
          {project ? ` · ${project.name}` : ''}
        </div>
      </div>
      {project && tones && (
        <span className="dot" style={{ background: tones.accent, width: 12, height: 12, borderRadius: '50%' }} />
      )}
      {onToggleBookmark && (
        <BookmarkButton bookmarked={p.bookmarked} onToggle={() => onToggleBookmark(p)} />
      )}
      <button
        className="mini-btn"
        aria-label="Kopieren"
        title="Kopieren"
        onClick={(e) => {
          e.stopPropagation()
          onCopy(p)
        }}
      >
        <Icon name="content_copy" />
      </button>
    </motion.div>
  )
}
