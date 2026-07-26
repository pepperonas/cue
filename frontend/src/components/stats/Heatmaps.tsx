// Two visualisations Recharts has no primitive for, hand-built with CSS grid:
// the weekday x hour rhythm matrix and the GitHub-style calendar. Both are
// pure DOM (no SVG text scaling issues), theme-aware through the accent colour
// and keyboard/screen-reader accessible via per-cell titles.
import { Fragment, useMemo, useState } from 'react'
import { buildCalendar, formatDay, heatOpacity } from '../../lib/stats'
import type { ActivityStats } from '../../lib/types'
import { EmptyHint } from './primitives'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function RhythmHeatmap({ cells, accent }: { cells: ActivityStats['heatmap']; accent: string }) {
  const max = useMemo(() => Math.max(0, ...cells.map((c) => c.count)), [cells])
  const byKey = useMemo(() => {
    const map = new Map<string, number>()
    for (const cell of cells) map.set(`${cell.weekday}-${cell.hour}`, cell.count)
    return map
  }, [cells])

  if (!max) return <EmptyHint text="Für diesen Zeitraum gibt es keine Aktivität." />

  return (
    <div className="rhythm">
      <div className="rhythm-grid" style={{ ['--heat' as string]: accent }}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={`h${hour}`} className="rhythm-hour">
            {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
          </span>
        ))}
        {WEEKDAYS.map((day, wd) => (
          <Fragment key={day}>
            <span className="rhythm-day">
              {day}
            </span>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = byKey.get(`${wd}-${hour}`) ?? 0
              return (
                <span
                  key={`${wd}-${hour}`}
                  className="rhythm-cell"
                  style={{ opacity: heatOpacity(count, max) || undefined }}
                  data-empty={count === 0 || undefined}
                  title={`${day} ${String(hour).padStart(2, '0')}:00 — ${count} Aktivitäten`}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      <Legend max={max} accent={accent} />
    </div>
  )
}

export function CalendarHeatmap({
  days,
  accent,
}: {
  days: { date: string; count: number }[]
  accent: string
}) {
  const { cells, weeks, max } = useMemo(() => buildCalendar(days), [days])
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null)

  if (!cells.length) return <EmptyHint text="Noch keine Tagesdaten." />

  // Month labels above the column where each month starts.
  const monthMarks: { week: number; label: string }[] = []
  let lastMonth = -1
  for (const cell of cells) {
    const month = Number(cell.date.slice(5, 7)) - 1
    if (month !== lastMonth) {
      monthMarks.push({ week: cell.week, label: MONTHS[month] })
      lastMonth = month
    }
  }

  return (
    <div className="calendar" style={{ ['--heat' as string]: accent }}>
      <div
        className="calendar-months"
        style={{ gridTemplateColumns: `repeat(${weeks}, var(--cal-cell))` }}
      >
        {monthMarks.map((mark) => (
          <span key={`${mark.label}-${mark.week}`} style={{ gridColumnStart: mark.week + 1 }}>
            {mark.label}
          </span>
        ))}
      </div>
      <div className="calendar-body">
        <div className="calendar-weekdays">
          {WEEKDAYS.map((day, i) => (
            <span key={day}>{i % 2 === 1 ? day : ''}</span>
          ))}
        </div>
        <div
          className="calendar-grid"
          style={{ gridTemplateColumns: `repeat(${weeks}, var(--cal-cell))` }}
        >
          {cells.map((cell) => (
            <span
              key={cell.date}
              className="calendar-cell"
              data-level={cell.level}
              style={{ gridColumnStart: cell.week + 1, gridRowStart: cell.weekday + 1 }}
              title={`${formatDay(cell.date)} — ${cell.count} Aktivitäten`}
              onMouseEnter={() => setHover(cell)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>
      </div>
      <div className="calendar-foot">
        <span className="calendar-hover">
          {hover ? `${formatDay(hover.date)} · ${hover.count} Aktivitäten` : `Maximum: ${max} an einem Tag`}
        </span>
        <span className="calendar-legend">
          weniger
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="calendar-cell" data-level={level} />
          ))}
          mehr
        </span>
      </div>
    </div>
  )
}

function Legend({ max, accent }: { max: number; accent: string }) {
  return (
    <div className="rhythm-legend" style={{ ['--heat' as string]: accent }}>
      <span>0</span>
      {[0.15, 0.4, 0.65, 0.9].map((step) => (
        <i key={step} style={{ opacity: step }} />
      ))}
      <span>{max}</span>
    </div>
  )
}

export function TagCloud({ tags, accent }: { tags: { tag: string; count: number }[]; accent: string }) {
  const { min, max } = useMemo(() => {
    const counts = tags.map((t) => t.count)
    return { min: Math.min(...counts, 0), max: Math.max(...counts, 1) }
  }, [tags])

  if (!tags.length) return <EmptyHint text="Noch keine Tags vergeben." />

  return (
    <div className="tag-cloud" style={{ ['--heat' as string]: accent }}>
      {tags.map((tag) => {
        const ratio = max > min ? (tag.count - min) / (max - min) : 1
        return (
          <span
            key={tag.tag}
            className="tag-cloud-item"
            style={{
              fontSize: `${(0.82 + ratio * 0.95).toFixed(2)}rem`,
              opacity: 0.55 + ratio * 0.45,
            }}
            title={`${tag.tag}: ${tag.count} Prompts`}
          >
            {tag.tag}
          </span>
        )
      })}
    </div>
  )
}
