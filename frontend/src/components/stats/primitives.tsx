// Building blocks of the statistics dashboard: KPI tiles, section cards,
// skeleton loaders and the two tiny hand-drawn charts (sparkline + progress).
// Everything here is presentational — data shaping lives in `lib/stats.ts`.
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../../lib/motion'
import { formatDelta, trendOf } from '../../lib/stats'
import type { Kpi } from '../../lib/types'
import { Icon } from '../ui'

const TREND_ICON = { up: 'trending_up', down: 'trending_down', flat: 'trending_flat', none: '' }

/** Staggered entrance shared by every card in the dashboard. */
export function Reveal({ index = 0, children }: { index?: number; children: ReactNode }) {
  const reduce = prefersReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { ...springs.spatial, delay: Math.min(index, 8) * 0.035 }}
      style={{ display: 'contents' }}
    >
      {children}
    </motion.div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  kpi,
  invert = false,
  icon,
  spark,
  accent,
  index = 0,
}: {
  label: string
  value: string
  hint?: string
  /** Drives the "vs. Vorperiode" chip. */
  kpi?: Kpi
  /** Metrics where a rise is bad (deletions, cost). */
  invert?: boolean
  icon?: string
  spark?: number[]
  accent?: string
  index?: number
}) {
  const trend = trendOf(kpi, invert)
  return (
    <Reveal index={index}>
      <article className="stat-card" style={accent ? { ['--stat-accent' as string]: accent } : undefined}>
        <header>
          {icon && <Icon name={icon} />}
          <span className="stat-label">{label}</span>
        </header>
        <strong className="stat-value">{value}</strong>
        <footer>
          {kpi && (
            <span className={`stat-delta trend-${trend}`}>
              {TREND_ICON[trend] && <Icon name={TREND_ICON[trend]} />}
              {formatDelta(kpi)}
            </span>
          )}
          {hint && <span className="stat-hint">{hint}</span>}
        </footer>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </article>
    </Reveal>
  )
}

/** Dependency-free sparkline: a KPI tile needs a shape, not a chart engine. */
export function Sparkline({ values, height = 34 }: { values: number[]; height?: number }) {
  const max = Math.max(...values, 1)
  const step = 100 / Math.max(values.length - 1, 1)
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`)
  const area = `M0,${height} L${points.join(' L')} L100,${height} Z`
  return (
    <svg className="stat-spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="stat-spark-area" d={area} />
      <polyline className="stat-spark-line" points={points.join(' ')} />
    </svg>
  )
}

export function ChartCard({
  title,
  subtitle,
  actions,
  wide,
  children,
  index = 0,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  wide?: boolean
  children: ReactNode
  index?: number
}) {
  return (
    <Reveal index={index}>
      <section className={`chart-card${wide ? ' chart-card--wide' : ''}`}>
        <header className="chart-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </header>
        <div className="chart-body">{children}</div>
      </section>
    </Reveal>
  )
}

/** Labelled progress bar for share-of-total metrics (test rate, backlog …). */
export function MeterRow({
  label,
  value,
  total,
  color,
  suffix,
}: {
  label: string
  value: number
  total: number
  color?: string
  suffix?: string
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  const reduce = prefersReducedMotion()
  return (
    <div className="meter-row">
      <span className="meter-label">{label}</span>
      <div className="meter-track" role="img" aria-label={`${label}: ${value} von ${total}`}>
        <motion.span
          className="meter-fill"
          style={color ? { background: color } : undefined}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : springs.spatial}
        />
      </div>
      <span className="meter-value">
        {value}
        {suffix ?? ''}
      </span>
    </div>
  )
}

export function EmptyHint({ text }: { text: string }) {
  return <p className="chart-empty">{text}</p>
}

export function SkeletonGrid() {
  return (
    <div className="stats-skeleton" aria-busy="true" aria-label="Statistiken werden geladen">
      <div className="stats-kpis">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton skeleton-kpi" />
        ))}
      </div>
      <div className="stats-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton skeleton-chart" />
        ))}
      </div>
    </div>
  )
}
