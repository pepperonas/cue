// Quiet status pill for a single optimization: first "fetching the GitHub
// context" (that happens inside the POST and can take a few seconds), then
// "waiting" / "being optimized" with the context the job actually carries.
// Batches keep their own ticker; this one stays out of its way.
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMutationState } from '@tanstack/react-query'
import { springs } from '../../lib/motion'
import { optimizeTicker } from '../../lib/optimize-ticker'
import {
  OPTIMIZE_PROMPT_KEY,
  useActiveOptimizations,
  useOptimizeBatch,
  usePrompts,
  useProjects,
} from '../../state/queries'
import { Icon } from '../ui'

export function OptimizeTicker({ enabled }: { enabled: boolean }) {
  const pending = useMutationState({
    filters: { mutationKey: OPTIMIZE_PROMPT_KEY, status: 'pending' },
    select: (m) => (m.state.variables as { promptId: number } | undefined)?.promptId ?? -1,
  })
  const { data: active = [] } = useActiveOptimizations(enabled)
  const { data: batch } = useOptimizeBatch(enabled)
  const { data: prompts = [] } = usePrompts()
  const { data: projects = [] } = useProjects()

  const state = useMemo(
    () => optimizeTicker(pending, active, prompts, projects),
    [pending, active, prompts, projects],
  )
  const batchRunning = !!batch && !batch.finished_at
  const show = enabled && !batchRunning && state !== null

  return (
    <AnimatePresence>
      {show && state && (
        <motion.div
          className="opt-ticker"
          data-phase={state.phase}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={springs.gentle}
        >
          {state.phase === 'context' ? (
            <Icon name="cloud_download" className="opt-ticker-icon" />
          ) : (
            <span className="spinner" aria-hidden="true" />
          )}
          <span className="opt-ticker-text">
            <span className="opt-ticker-main">{state.text}</span>
            {state.detail && <span className="opt-ticker-detail">{state.detail}</span>}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
