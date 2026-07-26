// Range selector: preset chips with a sliding indicator plus a custom
// from/to popover. The selection lives in StatsView and is persisted there —
// this component is stateless apart from the popover's open flag.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../../lib/motion'
import { RANGE_OPTIONS, formatDay, isoDaysAgo } from '../../lib/stats'
import type { StatsQuery, StatsRangeKey } from '../../lib/types'
import { Button, Icon } from '../ui'

export function RangePicker({
  query,
  onChange,
  onRefresh,
  updatedAt,
}: {
  query: StatsQuery
  onChange: (next: StatsQuery) => void
  onRefresh: () => void
  updatedAt?: string
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(query.from ?? isoDaysAgo(14))
  const [to, setTo] = useState(query.to ?? isoDaysAgo(0))
  const popRef = useRef<HTMLDivElement>(null)

  // Close the popover on an outside click / Escape (Escape must not bubble to
  // the app-level handlers while the popover owns the interaction).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (key: StatsRangeKey) => {
    if (key === 'custom') {
      setOpen(true)
      return
    }
    onChange({ range: key })
  }

  return (
    <div className="range-bar">
      <div className="range-chips" role="tablist" aria-label="Zeitraum">
        {RANGE_OPTIONS.map((option) => {
          const active = query.range === option.key
          return (
            <button
              key={option.key}
              role="tab"
              aria-selected={active}
              className="range-chip"
              data-active={active}
              onClick={() => pick(option.key)}
              title={option.label}
            >
              {active && (
                <motion.span
                  layoutId="range-indicator"
                  className="range-indicator"
                  transition={springs.spatialFast}
                />
              )}
              <span className="range-chip-text">
                {option.key === 'custom' && query.range === 'custom' && query.from
                  ? `${formatDay(query.from)} – ${formatDay(query.to ?? query.from)}`
                  : option.short}
              </span>
            </button>
          )
        })}
      </div>

      <div className="range-actions">
        {updatedAt && <span className="range-stamp">Stand {new Date(updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>}
        <button className="icon-btn" aria-label="Aktualisieren" title="Aktualisieren" onClick={onRefresh}>
          <Icon name="refresh" />
        </button>
      </div>

      {open && (
        <motion.div
          ref={popRef}
          className="range-pop"
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.spatialFast}
        >
          <h4>Benutzerdefinierter Zeitraum</h4>
          <label>
            Von
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Bis
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="range-pop-actions">
            <Button variant="text" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                onChange({ range: 'custom', from, to })
                setOpen(false)
              }}
            >
              Anwenden
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
