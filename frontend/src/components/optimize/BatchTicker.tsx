// Progress pill for "alle optimieren": shows "12 / 143 optimiert", the error
// count and a cancel button while a batch is running, and the final tally when
// it finishes. Mounted app-wide, mirroring RunTicker.
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { springs } from '../../lib/motion'
import { useCancelOptimizeBatch, useOptimizeBatch } from '../../state/queries'
import { useToast } from '../../state/toast'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../ui'

export function BatchTicker({ enabled }: { enabled: boolean }) {
  const { data: batch } = useOptimizeBatch(enabled)
  const cancel = useCancelOptimizeBatch()
  const toast = useToast()
  const qc = useQueryClient()
  const wasRunning = useRef(false)

  const running = !!batch && !batch.finished_at
  const done = batch ? batch.done : 0
  const total = batch ? batch.total : 0

  // On the running -> finished edge: refresh the board and report the tally.
  useEffect(() => {
    if (running) {
      wasRunning.current = true
      return
    }
    if (wasRunning.current && batch) {
      wasRunning.current = false
      qc.invalidateQueries({ queryKey: ['prompts'] })
      toast.show(
        batch.failed
          ? `${batch.done} erfolgreich · ${batch.failed} Fehler`
          : `${batch.done} Prompts optimiert`,
        batch.failed ? 'error' : 'success',
      )
    }
  }, [running, batch, qc, toast])

  // Keep the board in sync while the batch progresses.
  useEffect(() => {
    if (running) qc.invalidateQueries({ queryKey: ['prompts'] })
  }, [done, running, qc])

  return (
    <AnimatePresence>
      {running && batch && (
        <motion.div
          className="batch-ticker"
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={springs.bouncy}
        >
          <span className="spinner" aria-hidden="true" />
          <span className="batch-count">
            {done} / {total} optimiert
          </span>
          {batch.failed > 0 && <span className="batch-failed">{batch.failed} Fehler</span>}
          <span className="batch-bar" aria-hidden="true">
            <span style={{ width: `${total ? ((done + batch.failed) / total) * 100 : 0}%` }} />
          </span>
          <button
            className="btn btn--text"
            disabled={cancel.isPending || batch.canceled}
            onClick={() => cancel.mutate(batch.id)}
          >
            <Icon name="stop_circle" /> {batch.canceled ? 'wird beendet' : 'Abbrechen'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
