import { useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import type { Project, Prompt } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON } from '../lib/types'
import { Icon } from './ui'

interface Props {
  prompt: Prompt
  project?: Project
  dark: boolean
  selected?: boolean
  index: number
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
}

export function PromptCard({
  prompt,
  project,
  dark,
  selected,
  index,
  onOpen,
  onCopy,
  onToggleBookmark,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
    data: { status: prompt.status },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const tones = project ? projectTones(project.color, dark) : null

  // Single click opens the detail; double click copies. A short timer
  // discriminates the two so a double click never flashes the detail open.
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
      onOpen(prompt)
    }, 200)
  }
  function handleDoubleClick() {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    onCopy(prompt)
  }

  return (
    <motion.div
      layout="position"
      transition={springs.spatial}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      custom={index}
    >
      <div
        ref={setNodeRef}
        style={style}
        className={`card ${isDragging ? 'dragging' : ''} ${selected ? 'selected' : ''}`}
        data-prompt-id={prompt.id}
        title="Doppelklick kopiert den Prompt"
        {...attributes}
        {...listeners}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="card-title">{prompt.title || 'Untitled'}</div>
        <div className="card-body-preview">{prompt.body}</div>
        <div className="card-meta">
          {project && tones && (
            <span
              className="badge"
              style={{ background: tones.container, color: tones.on }}
            >
              <span className="dot" style={{ background: tones.accent }} />
              {project.name}
            </span>
          )}
          {prompt.tags &&
            prompt.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            {onToggleBookmark && (
              <button
                className={`mini-btn ${prompt.bookmarked ? 'bookmarked' : ''}`}
                aria-label={prompt.bookmarked ? 'Bookmark entfernen' : 'Bookmarken'}
                title={prompt.bookmarked ? 'Bookmark entfernen' : 'Bookmarken'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onToggleBookmark(prompt)}
              >
                <Icon name={prompt.bookmarked ? 'bookmark' : 'bookmark_border'} />
              </button>
            )}
            <button
              className="mini-btn"
              aria-label="Status"
              title={prompt.status}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onOpen(prompt)}
            >
              <Icon
                name={STATUS_ICON[prompt.status]}
                className={`st-icon ${STATUS_CLASS[prompt.status]}`}
              />
            </button>
            <button
              className="mini-btn"
              aria-label="Kopieren"
              title="Kopieren (c)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onCopy(prompt)}
            >
              <Icon name="content_copy" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
