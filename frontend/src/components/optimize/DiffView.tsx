// GitHub-style diff: red = removed, green = added, with word-level highlights
// inside rewritten lines and collapsed stretches of untouched text.
// Pure presentation — the diff model comes from `lib/diff.ts`.
import { useMemo, useState } from 'react'
import { buildDiff, collapseUnchanged, isGap } from '../../lib/diff'
import { Icon } from '../ui'

export function DiffView({
  original,
  optimized,
  context = 3,
}: {
  original: string
  optimized: string
  /** Untouched lines kept around each change before collapsing. */
  context?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const { rows, stats } = useMemo(() => buildDiff(original, optimized), [original, optimized])
  const entries = useMemo(
    () => (expanded ? rows : collapseUnchanged(rows, context)),
    [rows, expanded, context],
  )

  if (!rows.length) return <p className="diff-empty">Kein Text zum Vergleichen.</p>

  const unchangedOnly = stats.added === 0 && stats.removed === 0
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-stat diff-stat--add">+{stats.added}</span>
        <span className="diff-stat diff-stat--del">−{stats.removed}</span>
        <span className="diff-stat-rest">{stats.unchanged} unverändert</span>
        {!unchangedOnly && (
          <button className="diff-toggle" onClick={() => setExpanded((v) => !v)}>
            <Icon name={expanded ? 'unfold_less' : 'unfold_more'} />
            {expanded ? 'Nur Änderungen' : 'Alles anzeigen'}
          </button>
        )}
      </div>

      {unchangedOnly ? (
        <p className="diff-empty">Die optimierte Fassung ist identisch mit dem Original.</p>
      ) : (
        <div className="diff-body" role="table" aria-label="Unterschiede">
          {entries.map((entry, index) =>
            isGap(entry) ? (
              <button
                key={`gap-${index}`}
                className="diff-gap"
                onClick={() => setExpanded(true)}
                title="Ausgeblendete Zeilen anzeigen"
              >
                <Icon name="more_horiz" />
                {entry.gap} unveränderte {entry.gap === 1 ? 'Zeile' : 'Zeilen'}
              </button>
            ) : (
              <div key={index} className={`diff-row diff-row--${entry.kind}`} role="row">
                <span className="diff-ln">{entry.left ?? ''}</span>
                <span className="diff-ln">{entry.right ?? ''}</span>
                <span className="diff-sign">
                  {entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '−' : ''}
                </span>
                <code className="diff-text">
                  {entry.segments
                    ? entry.segments.map((segment, i) => (
                        <span key={i} className={segment.kind === 'unchanged' ? '' : `seg-${segment.kind}`}>
                          {segment.value}
                        </span>
                      ))
                    : entry.text || ' '}
                </code>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
