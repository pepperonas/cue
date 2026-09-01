import type { MetaChange } from '../../lib/optimization'
import { Icon } from '../ui'

/**
 * Title and tag changes a proposal carries, shown with the diff.
 *
 * Deliberately not a second diff: these are one short line each, and „alt →
 * neu" is read faster than a word-level colouring of six words. What matters is
 * that they are **visible before the decision** — the body is not the only
 * thing „Übernehmen" writes.
 */
export function MetaChanges({ changes }: { changes: MetaChange[] }) {
  if (changes.length === 0) return null
  return (
    <div className="opt-meta-changes">
      {changes.map((c) => (
        <div key={c.key} className="opt-meta-change">
          <span className="opt-meta-label">{c.label}</span>
          <span className="opt-meta-from">{c.from || '—'}</span>
          <Icon name="arrow_forward" />
          <span className="opt-meta-to">{c.to}</span>
        </div>
      ))}
    </div>
  )
}
