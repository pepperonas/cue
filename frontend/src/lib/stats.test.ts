import { describe, expect, it } from 'vitest'
import {
  buildCalendar,
  formatChars,
  formatCost,
  formatDay,
  formatDelta,
  formatHours,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSeconds,
  heatOpacity,
  isoDaysAgo,
  readableInk,
  tagFontSize,
  trendOf,
} from './stats'

describe('formatting', () => {
  it('compacts large numbers and keeps small ones readable', () => {
    expect(formatNumber(7)).toBe('7')
    expect(formatNumber(1234)).toBe('1.234')
    expect(formatNumber(12_400)).toBe('12,4k')
    expect(formatNumber(2_500_000)).toBe('2,5 Mio.')
    expect(formatNumber(Number.NaN)).toBe('–')
  })

  it('renders durations in the largest sensible unit', () => {
    expect(formatHours(0.25)).toBe('15 min')
    expect(formatHours(3.5)).toBe('3,5 h')
    expect(formatHours(72)).toBe('3 Tage')
    expect(formatHours(null)).toBe('–')
    expect(formatSeconds(42)).toBe('42 s')
    expect(formatSeconds(95)).toBe('1:35 min')
    expect(formatSeconds(undefined)).toBe('–')
  })

  it('formats chars, cost, percent and days', () => {
    expect(formatChars(1240)).toBe('1.240')
    expect(formatCost(1.5)).toContain('1,50')
    expect(formatPercent(66.66)).toBe('66,7 %')
    expect(formatPercent(null)).toBe('–')
    expect(formatDay('2026-07-15')).toBe('15.07.2026')
  })

  it('phrases relative timestamps in German', () => {
    const now = new Date('2026-07-15T12:00:00Z')
    expect(formatRelative('2026-07-15T11:59:40Z', now)).toBe('gerade eben')
    expect(formatRelative('2026-07-15T11:30:00Z', now)).toBe('vor 30 Min.')
    expect(formatRelative('2026-07-15T09:00:00Z', now)).toBe('vor 3 Std.')
    expect(formatRelative('2026-07-14T12:00:00Z', now)).toBe('vor 1 Tag')
    expect(formatRelative('2026-07-05T12:00:00Z', now)).toBe('vor 10 Tagen')
    expect(formatRelative('nonsense', now)).toBe('–')
  })
})

describe('trendOf', () => {
  it('maps a delta to a direction', () => {
    expect(trendOf({ value: 10, delta_pct: 25 })).toBe('up')
    expect(trendOf({ value: 10, delta_pct: -25 })).toBe('down')
    expect(trendOf({ value: 10, delta_pct: 0.1 })).toBe('flat')
    expect(trendOf({ value: 10, delta_pct: null })).toBe('none')
    expect(trendOf(undefined)).toBe('none')
  })

  it('inverts metrics where a rise is bad', () => {
    expect(trendOf({ value: 10, delta_pct: 25 }, true)).toBe('down')
    expect(trendOf({ value: 10, delta_pct: -25 }, true)).toBe('up')
  })

  it('formats the delta label', () => {
    expect(formatDelta({ value: 1, delta_pct: 12.5 })).toBe('+12,5 %')
    expect(formatDelta({ value: 1, delta_pct: -8 })).toBe('-8 %')
    expect(formatDelta({ value: 1, delta_pct: null })).toBe('keine Vorperiode')
  })
})

describe('buildCalendar', () => {
  const days = (counts: number[], start = '2026-07-01') =>
    counts.map((count, i) => ({
      date: new Date(new Date(`${start}T00:00:00Z`).getTime() + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      count,
    }))

  it('places days into Monday-based week columns', () => {
    // 2026-07-01 is a Wednesday -> weekday index 2.
    const { cells, weeks } = buildCalendar(days([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(cells[0].weekday).toBe(2)
    expect(cells[0].week).toBe(0)
    expect(cells[5].week).toBe(1) // crosses into the next column after Sunday
    expect(weeks).toBe(2)
  })

  it('scales intensity into quartile levels and keeps zero at level 0', () => {
    const { cells, max } = buildCalendar(days([0, 1, 4, 8, 20]))
    expect(max).toBe(20)
    expect(cells[0].level).toBe(0)
    expect(cells[1].level).toBeGreaterThanOrEqual(1)
    expect(cells[4].level).toBe(4)
    // Levels never decrease as counts rise.
    const levels = cells.map((c) => c.level)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
  })

  it('survives an empty range', () => {
    expect(buildCalendar([])).toEqual({ cells: [], weeks: 0, max: 0 })
  })
})

describe('scales', () => {
  it('sizes tag-cloud entries between the extremes', () => {
    expect(tagFontSize(5, 5, 5)).toBe(1)
    expect(tagFontSize(1, 1, 10)).toBeLessThan(tagFontSize(10, 1, 10))
    expect(tagFontSize(10, 1, 10)).toBeLessThanOrEqual(1.8)
  })

  it('maps heatmap counts to opacities', () => {
    expect(heatOpacity(0, 10)).toBe(0)
    expect(heatOpacity(10, 10)).toBe(1)
    expect(heatOpacity(5, 10)).toBeGreaterThan(0)
    expect(heatOpacity(5, 0)).toBe(0)
  })

  it('computes ISO days for the custom-range defaults', () => {
    const today = new Date('2026-07-15T10:00:00Z')
    expect(isoDaysAgo(0, today)).toBe('2026-07-15')
    expect(isoDaysAgo(14, today)).toBe('2026-07-01')
  })
})

describe('readableInk', () => {
  it('picks dark ink on light backgrounds and light ink on dark ones', () => {
    expect(readableInk('#ffffff')).toBe('#0d1117')
    expect(readableInk('#f5c469')).toBe('#0d1117')
    expect(readableInk('#6750A4')).toBe('#ffffff')
    expect(readableInk('#000')).toBe('#ffffff')
  })

  it('falls back to dark ink for unparseable input', () => {
    expect(readableInk('nope')).toBe('#0d1117')
  })
})
