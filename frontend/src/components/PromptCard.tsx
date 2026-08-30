import { useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import { isOptimizable } from '../lib/optimization'
import { dedupeTags } from '../lib/tags'
import type { Priority, Project, Prompt } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON } from '../lib/types'
import { BlockedButton } from './BlockedButton'
import { PriorityButton } from './PriorityButton'
import { BookmarkButton } from './BookmarkButton'
import { TestedButton } from './TestedButton'
import { RelativeTime } from './RelativeTime'
import { OptimizeButton } from './optimize/OptimizeButton'
import { Icon } from './ui'

interface Props {
  prompt: Prompt
  project?: Project
  dark: boolean
  selected?: boolean
  index: number
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
  onDuplicate?: (p: Prompt) => void
  onToggleBookmark?: (p: Prompt) => void
  onToggleTested?: (p: Prompt) => void
  // Prompt optimization (owner-only): undefined hides the button entirely.
  onOptimize?: (p: Prompt) => void
  optimizeBusy?: boolean
  onToggleBlocked?: (p: Prompt) => void
  onSetPriority?: (p: Prompt, next: Priority) => void
  selectMode?: boolean
  /** Part of a multi-card drag, but not the grabbed card: drawn as on the move. */
  carried?: boolean
  selectedForMerge?: boolean
  onToggleSelect?: (p: Prompt) => void
  onModSelect?: (p: Prompt) => void
}

export function PromptCard({
  prompt,
  project,
  dark,
  selected,
  index,
  onOpen,
  onCopy,
  onDuplicate,
  onToggleBookmark,
  onToggleTested,
  onOptimize,
  optimizeBusy = false,
  onToggleBlocked,
  onSetPriority,
  selectMode,
  carried,
  selectedForMerge,
  onToggleSelect,
  onModSelect,
}: Props) {
  const canTest = prompt.status === 'running' || prompt.status === 'done'
  // Blocking and priority are both queue-only: a control that cannot do
  // anything where it sits is worse than no control.
  const canBlock = prompt.status === 'queued'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
    data: { status: prompt.status },
  })
  // Blocked cards never drag. In select mode only the SELECTED ones do — that
  // is how a multi-selection is moved between the columns, while a tap on an
  // unselected card still just adds it to the selection.
  const draggable = !prompt.blocked && (!selectMode || !!selectedForMerge)

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

  function handleClick(e: React.MouseEvent) {
    // Cmd/Ctrl+click toggles multi-select (works with or without select mode).
    if ((e.metaKey || e.ctrlKey) && onModSelect) {
      if (clickTimer.current) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      onModSelect(prompt)
      return
    }
    if (selectMode) {
      onToggleSelect?.(prompt)
      return
    }
    if (clickTimer.current) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      onOpen(prompt)
    }, 200)
  }
  function handleDoubleClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) return // two fast mod+clicks are selection toggles, not a copy
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
        className={`card ${isDragging ? 'dragging' : ''} ${selected ? 'selected' : ''} ${
          selectMode ? 'selecting' : ''
        } ${selectedForMerge ? 'merge-selected' : ''} ${prompt.blocked ? 'blocked' : ''} ${
          carried ? 'carried' : ''
        }`}
        data-prompt-id={prompt.id}
        title={selectMode ? undefined : 'Doppelklick kopiert den Prompt'}
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        onClick={handleClick}
        onDoubleClick={selectMode ? undefined : handleDoubleClick}
      >
        {selectMode && (
          <span className="merge-check" aria-hidden="true">
            <Icon name={selectedForMerge ? 'check_box' : 'check_box_outline_blank'} />
          </span>
        )}
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
          {dedupeTags(prompt.tags).map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
          {prompt.attachments.length > 0 && (
            <span className="tag" title="Screenshots">
              <Icon name="image" /> {prompt.attachments.length}
            </span>
          )}
          {/* Age and actions are one block so the age keeps the same spot no
              matter how many tags wrapped above it — a column of cards is only
              scannable if the number is always in the same place. */}
          <div className="card-end">
            <RelativeTime prompt={prompt} />
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              {onOptimize && isOptimizable(prompt) && (
                <OptimizeButton
                  prompt={prompt}
                  busy={optimizeBusy}
                  onOptimize={onOptimize}
                />
              )}
              {onToggleTested && canTest && (
                <TestedButton
                  tested={prompt.tested}
                  disabled={prompt.status !== 'done'}
                  onToggle={() => onToggleTested(prompt)}
                />
              )}
              {onToggleBlocked && canBlock && (
                <BlockedButton blocked={prompt.blocked} onToggle={() => onToggleBlocked(prompt)} />
              )}
              {onSetPriority && canBlock && (
                <PriorityButton
                  priority={prompt.priority}
                  onChange={(next) => onSetPriority(prompt, next)}
                />
              )}
              {onToggleBookmark && (
                <BookmarkButton
                  bookmarked={prompt.bookmarked}
                  onToggle={() => onToggleBookmark(prompt)}
                />
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
              {onDuplicate && (
                <button
                  className="mini-btn"
                  aria-label="Duplizieren"
                  title="Duplizieren"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onDuplicate(prompt)}
                >
                  <Icon name="control_point_duplicate" />
                </button>
              )}
              <button
                className="mini-btn copy-btn"
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
      </div>
    </motion.div>
  )
}
