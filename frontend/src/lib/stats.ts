// Pure presentation helpers for the statistics dashboard: number/duration
// formatting, trend interpretation, and the geometry of the two hand-built
// visualisations (calendar heatmap, tag cloud). Kept free of React so they can
// be unit tested — the chart components stay thin wrappers around Recharts.
import type { Kpi, StatsRangeKey } from './types'

export const RANGE_OPTIONS: { key: StatsRangeKey; label: string; short: string }[] = [
  { key: 'today', label: 'Heute', short: 'Heute' },
  { key: 'yesterday', label: 'Gestern', short: 'Gestern' },
  { key: '7d', label: 'Letzte 7 Tage', short: '7 T' },
  { key: '30d', label: 'Letzte 30 Tage', short: '30 T' },
  { key: '90d', label: 'Letzte 90 Tage', short: '90 T' },
  { key: 'year', label: 'Dieses Jahr', short: 'Jahr' },
  { key: 'last_year', label: 'Letztes Jahr', short: 'Vorjahr' },
  { key: 'all', label: 'Gesamter Zeitraum', short: 'Gesamt' },
  { key: 'custom', label: 'Benutzerdefiniert', short: 'Custom' },
]

/** Compact number formatting for KPI tiles (1.2k instead of 1234). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)} Mio.`
  if (abs >= 10_000) return `${trimZero(value / 1000)}k`
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: abs < 10 ? 2 : 0 }).format(value)
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '').replace('.', ',')
}

/** Byte-ish character counts: 1.240 Zeichen -> "1.240". */
export function formatChars(value: number): string {
  return new Intl.NumberFormat('de-DE').format(Math.round(value))
}

/** Hours as a human duration: 0.4 -> "24 min", 30 -> "1,3 Tage". */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '–'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${trimZero(hours)} h`
  return `${trimZero(hours / 24)} Tage`
}

/** Seconds as a human duration: 95 -> "1:35 min". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const mins = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${mins}:${String(rest).padStart(2, '0')} min`
}

export function formatCost(usd: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: usd < 10 ? 2 : 0,
  }).format(usd)
}

/**
 * A cost that may not exist.
 *
 * "—" rather than "$0.00": zero optimized prompts is not the same statement as
 * "it was free", and the difference is the whole point of the unpriced-attempt
 * counter next to it.
 */
export function formatCostOrDash(usd: number | null | undefined): string {
  return usd == null ? '—' : formatCost(usd)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  return `${trimZero(value)} %`
}

export type Trend = 'up' | 'down' | 'flat' | 'none'

/** Direction of a KPI's change. `invert` marks metrics where less is better
 *  (deletions, cost), so the UI can colour a rise as a regression. */
export function trendOf(kpi: Kpi | undefined, invert = false): Trend {
  if (!kpi || kpi.delta_pct === null || kpi.delta_pct === undefined) return 'none'
  if (Math.abs(kpi.delta_pct) < 0.5) return 'flat'
  const rising = kpi.delta_pct > 0
  if (!invert) return rising ? 'up' : 'down'
  return rising ? 'down' : 'up'
}

export function formatDelta(kpi: Kpi | undefined): string {
  if (!kpi || kpi.delta_pct === null || kpi.delta_pct === undefined) return 'keine Vorperiode'
  const sign = kpi.delta_pct > 0 ? '+' : ''
  return `${sign}${trimZero(kpi.delta_pct)} %`
}

export interface CalendarCell {
  date: string
  count: number
  /** 0 = no activity, 1–4 = intensity buckets (GitHub-style quartiles). */
  level: 0 | 1 | 2 | 3 | 4
  weekday: number
  week: number
}

/**
 * Lay a flat day list out as calendar columns (one column = one ISO week,
 * Monday on top). Intensity levels are quartiles of the non-zero counts, so a
 * quiet month still shows contrast instead of one flat colour.
 */
export function buildCalendar(days: { date: string; count: number }[]): {
  cells: CalendarCell[]
  weeks: number
  max: number
} {
  if (!days.length) return { cells: [], weeks: 0, max: 0 }
  const counts = days.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b)
  const max = counts.length ? counts[counts.length - 1] : 0
  const q = (p: number) => (counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * p))] : 0)
  const thresholds = [q(0.25), q(0.5), q(0.75)]

  const first = new Date(`${days[0].date}T00:00:00`)
  // Monday-based offset of the first cell inside its week column.
  const offset = (first.getDay() + 6) % 7
  const cells = days.map((day, index) => {
    const weekday = (index + offset) % 7
    const week = Math.floor((index + offset) / 7)
    let level: CalendarCell['level'] = 0
    if (day.count > 0) {
      // `>=` (not `>`): the busiest day must always reach the top level, even
      // when it IS the 75th percentile of a small sample.
      level = 1
      if (day.count >= thresholds[0]) level = 2
      if (day.count >= thresholds[1]) level = 3
      if (day.count >= thresholds[2]) level = 4
    }
    return { date: day.date, count: day.count, level, weekday, week }
  })
  return { cells, weeks: cells.length ? cells[cells.length - 1].week + 1 : 0, max }
}

/** Font size (rem) for a tag-cloud entry, scaled between min and max count. */
export function tagFontSize(count: number, min: number, max: number): number {
  if (max <= min) return 1
  const ratio = (count - min) / (max - min)
  return Math.round((0.82 + ratio * 0.95) * 100) / 100
}

/** Opacity for a heatmap cell relative to the busiest cell. */
export function heatOpacity(count: number, max: number): number {
  if (!max || !count) return 0
  return Math.round((0.14 + (count / max) * 0.86) * 100) / 100
}

const DAY_MS = 86_400_000

/** ISO date (YYYY-MM-DD) `offset` days before today — the custom-range default. */
export function isoDaysAgo(offset: number, today = new Date()): string {
  return new Date(today.getTime() - offset * DAY_MS).toISOString().slice(0, 10)
}

/** "2026-07-15" -> "15.07.2026" (dates arrive as plain ISO days). */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

/** Relative German phrasing for a timestamp ("vor 3 Std."). */
export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '–'
  const diff = now.getTime() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'gerade eben'
  if (mins < 60) return `vor ${mins} Min.`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  if (days < 31) return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`
  const months = Math.round(days / 30)
  return `vor ${months} Mon.`
}

/** Black or white ink for text placed on an arbitrary background colour
 *  (project seeds are user-chosen, so a fixed ink would fail on half of them).
 *  Uses the WCAG relative-luminance threshold. */
export function readableInk(hex: string): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const value = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(value)) return '#0d1117'
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const r = channel((value >> 16) & 255)
  const g = channel((value >> 8) & 255)
  const b = channel(value & 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#0d1117' : '#ffffff'
}
