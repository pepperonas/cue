// The optimization section of the prompt detail: switch between original and
// optimized text, inspect the diff, re-optimize, and open older versions.
//
// It owns no data — texts come from the prompt itself, the version list from
// `useOptimizationHistory`. Which text the detail sheet renders is controlled
// by the parent (`view`), so copy/select keep working on the visible variant.
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { springs } from '../../lib/motion'
import { pendingProposal } from '../../lib/optimization'
import { useOptimizationHistory } from '../../state/queries'
import type { Optimization, Prompt } from '../../lib/types'
import { Icon } from '../ui'
import { DiffView } from './DiffView'

export type PromptVariant = 'original' | 'optimized' | 'diff'

const DECISION_LABEL: Record<string, string> = {
  pending: 'noch nicht entschieden',
  applied: 'übernommen',
  discarded: 'verworfen',
  // Replaced by a newer run before anyone looked at it — never reviewed, so it
  // must not read as "verworfen".
  superseded: 'durch eine neuere Fassung ersetzt',
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'wartet',
  running: 'läuft',
  succeeded: 'erfolgreich',
  failed: 'fehlgeschlagen',
  canceled: 'abgebrochen',
}

function formatDuration(ms: number | null): string {
  if (!ms) return '–'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

function formatCost(usd: number | null): string {
  if (usd === null || usd === undefined) return '–'
  return `$${usd.toFixed(4)}`
}

export function OptimizationPanel({
  prompt,
  view,
  onView,
  busy,
  onOptimize,
  onCancel,
  activeJob,
  onOpenVersion,
  selectedVersion,
  onApply,
  onDiscard,
  deciding,
}: {
  prompt: Prompt
  view: PromptVariant
  onView: (view: PromptVariant) => void
  busy: boolean
  onOptimize: () => void
  onCancel: () => void
  /** The queued/running job for this prompt, if any. */
  activeJob: Optimization | null
  onOpenVersion: (optimization: Optimization) => void
  selectedVersion: number | null
  /** Take the proposal over into the prompt text / drop it. */
  onApply: (optimization: Optimization) => void
  onDiscard: (optimization: Optimization) => void
  deciding: boolean
}) {
  const { data: history } = useOptimizationHistory(prompt.id)
  const versions = useMemo(
    () => (history ?? []).filter((row) => row.status === 'succeeded'),
    [history],
  )
  const lastFailure = useMemo(
    () => (history ?? []).find((row) => row.status === 'failed') ?? null,
    [history],
  )
  const shown = useMemo(
    () => versions.find((row) => row.version === selectedVersion) ?? versions[0] ?? null,
    [versions, selectedVersion],
  )
  // The proposal awaiting a decision (rule + reasoning in lib/optimization.ts).
  const pending = useMemo(() => pendingProposal(prompt, versions), [prompt, versions])

  // Nothing yet: a single call to action (the button also lives on the card).
  if (!prompt.optimized && !busy) {
    return (
      <div className="opt-panel opt-panel--empty">
        <button className="btn btn--tonal" onClick={onOptimize}>
          <Icon name="auto_awesome" /> Optimieren
        </button>
        <p className="opt-hint">
          Claude Code CLI schreibt den Prompt um — das Original bleibt unverändert erhalten.
        </p>
        {lastFailure?.error && (
          <p className="opt-error">
            <Icon name="error" /> Letzter Versuch: {lastFailure.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="opt-panel">
      <header className="opt-head">
        <span className={`opt-badge ${busy ? 'is-busy' : ''}`}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Optimierung läuft …
            </>
          ) : (
            <>
              <Icon name="check_circle" /> Optimiert
              {prompt.optimization_version > 0 && <b>v{prompt.optimization_version}</b>}
            </>
          )}
        </span>
        {busy ? (
          <button className="btn btn--text" onClick={onCancel}>
            <Icon name="close" /> Abbrechen
          </button>
        ) : (
          <button className="btn btn--text" onClick={onOptimize}>
            <Icon name="refresh" /> Erneut optimieren
          </button>
        )}
      </header>

      {prompt.optimized && (
        <>
          <div className="opt-switch" role="tablist" aria-label="Fassung">
            {(
              [
                ['original', 'Original anzeigen'],
                ['optimized', 'Optimierte Version'],
                ['diff', 'Unterschiede'],
              ] as [PromptVariant, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                className="opt-switch-btn"
                data-active={view === key}
                onClick={() => onView(key)}
              >
                {view === key && (
                  <motion.span
                    layoutId={`opt-switch-${prompt.id}`}
                    className="opt-switch-indicator"
                    transition={springs.spatialFast}
                  />
                )}
                <span className="opt-switch-label">{label}</span>
              </button>
            ))}
          </div>

          <AnimatePresence initial={false}>
            {view === 'diff' && shown && (
              <motion.div
                key="diff"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springs.spatialFast}
                style={{ overflow: 'hidden' }}
              >
                <DiffView original={shown.original_text} optimized={shown.optimized_text ?? ''} />
              </motion.div>
            )}
          </AnimatePresence>

          {pending && (
            <div className="opt-decide">
              <p className="opt-decide-text">
                <Icon name="rule" />
                Vorschlag prüfen: Der Prompt-Text ist unverändert, bis du übernimmst.
              </p>
              <div className="opt-decide-actions">
                <button
                  className="btn btn--text"
                  disabled={deciding}
                  onClick={() => onDiscard(pending)}
                >
                  <Icon name="close" /> Verwerfen
                </button>
                <button
                  className="btn btn--filled"
                  disabled={deciding}
                  onClick={() => onApply(pending)}
                >
                  <Icon name="check" /> Übernehmen
                </button>
              </div>
            </div>
          )}

          {versions.length > 0 && (
            <div className="opt-meta">
              <span title="Verwendetes Modell">
                <Icon name="smart_toy" /> {prompt.optimization_model || 'Claude Code CLI'}
              </span>
              <span title="Dauer der Optimierung">
                <Icon name="timer" /> {formatDuration(versions[0].duration_ms)}
              </span>
              <span title="Kosten laut CLI">
                <Icon name="payments" /> {formatCost(versions[0].cost_usd)}
              </span>
              {versions[0].output_tokens !== null && (
                <span title="Tokens (Ein-/Ausgabe)">
                  <Icon name="tag" /> {versions[0].input_tokens ?? 0}/{versions[0].output_tokens}
                </span>
              )}
              {shown?.universal && (
                <span title="Als Bookmark projektunabhängig umgeschrieben — Platzhalter statt konkreter Pfade und Namen">
                  <Icon name="public" /> universell
                </span>
              )}
            </div>
          )}

          {versions.length > 1 && (
            <div className="opt-versions">
              <span className="opt-versions-label">Historie</span>
              {versions.map((row) => (
                <button
                  key={row.id}
                  className="opt-version"
                  data-active={(selectedVersion ?? versions[0].version) === row.version}
                  onClick={() => onOpenVersion(row)}
                  title={`Version ${row.version}${row.universal ? ' (universell)' : ''} — ${
                    DECISION_LABEL[row.decision]
                  }, ${new Date(row.finished_at ?? row.created_at).toLocaleString('de-DE')}`}
                >
                  v{row.version}
                  {row.decision !== 'pending' && (
                    <Icon
                      name={
                        row.decision === 'applied'
                          ? 'check'
                          : row.decision === 'superseded'
                            ? 'history'
                            : 'close'
                      }
                      className={`opt-version-mark is-${row.decision}`}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {activeJob?.status === 'queued' && (
        <p className="opt-hint">In der Warteschlange — der Runner arbeitet die Jobs nacheinander ab.</p>
      )}
      {lastFailure?.error && !busy && (
        <p className="opt-error">
          <Icon name="error" /> Letzter Fehler: {lastFailure.error} (
          {STATUS_LABEL[lastFailure.status] ?? lastFailure.status})
        </p>
      )}
    </div>
  )
}
