import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import type { Project, Prompt } from '../lib/types'
import { PromptEditor } from './PromptEditor'
import { useBackDismiss } from '../state/overlays'

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
  onClose: () => void
}

/**
 * The standalone prompt dialog: a surface around {@link PromptEditor}.
 *
 * The form itself lives in that component because the detail sheet hosts the
 * very same one — editing a prompt you already have open must not tear one
 * dialog down and animate a second one in.
 */
export function Composer({ projects, editing, defaultProjectId, asBookmark, onClose }: Props) {
  // Back gesture / browser back closes this overlay instead of the app.
  useBackDismiss(onClose)
  const isEdit = !!editing

  return (
    // Editing never closes on a backdrop click — an accidental click outside
    // must not discard the changes. A new prompt may: its draft autosaves.
    <div className="scrim" onClick={isEdit ? undefined : onClose}>
      <motion.div
        layoutId="composer-surface"
        className="sheet sheet--composer"
        onClick={(e) => e.stopPropagation()}
        transition={springs.spatial}
      >
        <PromptEditor
          projects={projects}
          editing={editing}
          defaultProjectId={defaultProjectId}
          asBookmark={asBookmark}
          scrollClassName="composer-scroll"
          idPrefix="c"
          onCancel={onClose}
          onSaved={onClose}
        />
      </motion.div>
    </div>
  )
}
