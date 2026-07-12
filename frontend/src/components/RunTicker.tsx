import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { springs } from '../lib/motion'
import { RUN_ACTIVE, type Run } from '../lib/types'
import { useRuns } from '../state/queries'
import { useToast } from '../state/toast'
import { Icon } from './ui'

const KIND_LABEL: Record<string, string> = { single: 'Run', chain: 'Playbook' }
const STATUS_LABEL: Record<string, string> = {
  queued: 'wartet',
  claiming: 'startet…',
  running: 'läuft…',
}

/** Small always-visible overlay while cue is processing runs. Polls the runs
 * query (shared with the Runs tab); when a run finishes it refreshes the
 * prompts (the board reflects the queued→done move) and toasts the outcome. */
export function RunTicker({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: runs } = useRuns(enabled)
  const active = (runs ?? []).filter((r) => RUN_ACTIVE.includes(r.status))

  // Detect active→terminal transitions to refresh the board + notify.
  const prevActive = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!runs) return
    let finished: Run | null = null
    for (const id of prevActive.current) {
      const now = runs.find((r) => r.id === id)
      if (now && !RUN_ACTIVE.includes(now.status)) finished = now
    }
    if (finished) {
      void qc.invalidateQueries({ queryKey: ['prompts'] })
      toast.show(
        finished.status === 'succeeded'
          ? 'Run abgeschlossen — Prompt(s) auf Done'
          : finished.status === 'failed'
            ? 'Run fehlgeschlagen'
            : 'Run abgebrochen',
        finished.status === 'succeeded' ? 'success' : 'error',
      )
    }
    prevActive.current = new Set(active.map((r) => r.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs])

  if (!enabled || active.length === 0) return null
  const first = active[0]
  const label =
    active.length === 1
      ? `${KIND_LABEL[first.kind] ?? 'Run'} ${STATUS_LABEL[first.status] ?? first.status}`
      : `${active.length} Runs aktiv`
  return (
    <motion.button
      className="run-ticker"
      onClick={onOpen}
      title="Zu den Runs"
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springs.spatial}
    >
      <Icon name="progress_activity" className="spin" />
      <span>{label}</span>
    </motion.button>
  )
}
