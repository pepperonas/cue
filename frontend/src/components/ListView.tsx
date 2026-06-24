import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import type { Project, Prompt } from '../lib/types'
import { STATUS_ICON, STATUS_LABEL } from '../lib/types'
import { Icon } from './ui'

interface Props {
  prompts: Prompt[]
  projects: Map<number, Project>
  dark: boolean
  selectedId: number | null
  onOpen: (p: Prompt) => void
  onCopy: (p: Prompt) => void
}

export function ListView({ prompts, projects, dark, selectedId, onOpen, onCopy }: Props) {
  const sorted = [...prompts].sort(
    (a, b) =>
      a.status.localeCompare(b.status) || a.sort_order - b.sort_order || a.id - b.id,
  )

  return (
    <div className="list">
      {sorted.map((p, i) => {
        const project = p.project_id ? projects.get(p.project_id) : undefined
        const tones = project ? projectTones(project.color, dark) : null
        return (
          <motion.div
            key={p.id}
            className={`list-item ${selectedId === p.id ? 'selected' : ''}`}
            data-prompt-id={p.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.spatial, delay: Math.min(i * 0.02, 0.2) }}
            onClick={() => onOpen(p)}
            style={selectedId === p.id ? { outline: '2px solid var(--md-primary)' } : undefined}
          >
            <Icon name={STATUS_ICON[p.status]} className="" />
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
      })}
    </div>
  )
}
