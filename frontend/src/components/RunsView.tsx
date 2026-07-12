import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { copyText } from '../lib/clipboard'
import type { Run } from '../lib/types'
import { RUN_ACTIVE, RUN_STATUS_ICON, RUN_STATUS_LABEL } from '../lib/types'
import { useCancelRun, useCreateRun, useRun, useRuns } from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon } from './ui'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

/** One run row + expandable detail. Each open card fetches (and polls) its own
 * detail, so several runs — e.g. all active ones — can be open at once. */
function RunCard({
  run,
  index,
  open,
  onToggle,
}: {
  run: Run
  index: number
  open: boolean
  onToggle: () => void
}) {
  const toast = useToast()
  const cancel = useCancelRun()
  const create = useCreateRun()
  const { data: d } = useRun(open ? run.id : null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [d?.logs?.length])

  function reRun() {
    const steps = [...(d?.steps ?? [])].sort((a, b) => a.step_index - b.step_index)
    const ids = steps.map((s) => s.prompt_id)
    if (!steps.length || ids.some((x) => x == null)) {
      toast.show('Re-run nicht möglich (Quell-Prompt gelöscht)', 'error')
      return
    }
    create.mutate(
      {
        kind: run.kind,
        prompt_ids: ids as number[],
        project_path: run.project_path,
        model: run.model,
        allowed_tools: run.allowed_tools,
        permission_mode: run.permission_mode,
        bare: run.bare,
        skip_permissions: run.skip_permissions,
        stop_on_error: run.stop_on_error,
      },
      { onSuccess: () => toast.show('Erneut gestartet', 'success') },
    )
  }

  return (
    <motion.div
      className="run-card"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.spatial, delay: Math.min(index * 0.02, 0.2) }}
    >
      <button className="run-head" onClick={onToggle} aria-expanded={open}>
        <span className={`run-badge st-${run.status}`}>
          <Icon name={RUN_STATUS_ICON[run.status]} /> {RUN_STATUS_LABEL[run.status]}
        </span>
        <span className="run-title grow">
          {run.kind === 'chain' ? '⛓ Playbook' : 'Prompt'} · {basename(run.project_path)}
        </span>
        {run.steps_total > 1 && (
          <span className="muted run-progress">
            {run.steps_done}/{run.steps_total}
          </span>
        )}
        {run.total_cost_usd != null && (
          <span className="muted run-cost">${run.total_cost_usd.toFixed(3)}</span>
        )}
        <span className="muted run-time">{fmt(run.created_at)}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} />
      </button>

      {open && d && (
        <div className="run-detail">
          {d.error && <div className="run-error">{d.error}</div>}

          <div className="run-meta">
            <code title={d.project_path}>{d.project_path}</code>
            {d.claude_session_id && (
              <button
                className="chip"
                title="Session-ID kopieren"
                onClick={() => {
                  void copyText(d.claude_session_id as string)
                  toast.show('Session-ID kopiert', 'success')
                }}
              >
                <Icon name="content_copy" /> {d.claude_session_id.slice(0, 8)}…
              </button>
            )}
            {d.model && <span className="tag">{d.model}</span>}
            {d.permission_mode && <span className="tag">{d.permission_mode}</span>}
          </div>

          <div className="run-steps">
            {d.steps.map((s) => (
              <div className="run-step" key={s.id}>
                <span className={`run-badge st-${s.status}`}>
                  <Icon name={RUN_STATUS_ICON[s.status]} /> {s.step_index + 1}
                </span>
                <span className="grow run-step-text">{s.prompt_text.split('\n')[0]}</span>
                {s.cost_usd != null && <span className="muted">${s.cost_usd.toFixed(3)}</span>}
              </div>
            ))}
          </div>

          <div className="run-log" ref={logRef}>
            {d.logs.length === 0 ? (
              <span className="muted">Noch keine Ausgabe…</span>
            ) : (
              d.logs.map((lg) => (
                <div className="run-log-line" key={lg.seq}>
                  <span className="run-log-ev">{lg.event_type}</span> {lg.line}
                </div>
              ))
            )}
          </div>

          <div className="row-end">
            {RUN_ACTIVE.includes(d.status) && (
              <Button
                variant="danger"
                icon="stop_circle"
                onClick={() => {
                  cancel.mutate(d.id)
                  toast.show('Abbruch angefordert', 'info')
                }}
              >
                Abbrechen
              </Button>
            )}
            <Button variant="tonal" icon="replay" onClick={reRun}>
              Erneut ausführen
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

export function RunsView({ canRun }: { canRun: boolean }) {
  const { data: runs, isLoading } = useRuns(canRun)
  // Active runs are expanded by default; a manual toggle overrides that (and
  // sticks — also across the run finishing, until the tab unmounts).
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({})

  if (!canRun) {
    return (
      <div className="empty">
        <Icon name="lock" />
        <h3 style={{ margin: 0 }}>Nicht verfügbar</h3>
        <p className="muted">Das Ausführen von Prompts ist dem Owner vorbehalten.</p>
      </div>
    )
  }

  if (!isLoading && (runs ?? []).length === 0) {
    return (
      <div className="empty">
        <Icon name="play_circle" />
        <h3 style={{ margin: 0 }}>Keine Runs</h3>
        <p className="muted">
          Starte einen Prompt über „Ausführen" im Detail oder ein Playbook über die Auswahl.
        </p>
      </div>
    )
  }

  return (
    <div className="runs-list">
      {(runs ?? []).map((run, i) => {
        const open = openOverride[run.id] ?? RUN_ACTIVE.includes(run.status)
        return (
          <RunCard
            key={run.id}
            run={run}
            index={i}
            open={open}
            onToggle={() => setOpenOverride((o) => ({ ...o, [run.id]: !open }))}
          />
        )
      })}
    </div>
  )
}
