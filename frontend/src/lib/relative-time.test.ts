import { describe, expect, it } from 'vitest'
import { formatAge, formatAbsolute, parseTimestamp, promptAge, promptTimes } from './relative-time'

const T0 = Date.parse('2026-08-23T12:00:00Z')
const ago = (ms: number) => T0 - ms
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('parseTimestamp', () => {
  it('reads a timestamp with a zone designator', () => {
    expect(parseTimestamp('2026-08-23T12:00:00Z')).toBe(T0)
    expect(parseTimestamp('2026-08-23T12:00:00+00:00')).toBe(T0)
    expect(parseTimestamp('2026-08-23T14:00:00+02:00')).toBe(T0)
  })

  it('treats a MISSING zone as UTC, not as the viewer local time', () => {
    // The defect this guards against: SQLite hands rows back naive, and a
    // date-time without a designator is LOCAL time to every browser. In Berlin
    // that shifted every timestamp two hours into the future, i.e. everything
    // younger than two hours read as "gerade eben" forever.
    expect(parseTimestamp('2026-08-23T12:00:00')).toBe(T0)
    expect(parseTimestamp('2026-08-23T12:00:00.839915')).toBe(T0 + 839)
  })

  it('accepts the space-separated form SQLite writes', () => {
    expect(parseTimestamp('2026-08-23 12:00:00')).toBe(T0)
  })

  it('returns null for nothing and for nonsense', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('irgendwann')).toBeNull()
  })
})

describe('formatAge', () => {
  it('calls the first three quarters of a minute "gerade eben"', () => {
    expect(formatAge(ago(0), T0)).toBe('gerade eben')
    expect(formatAge(ago(44 * SEC), T0)).toBe('gerade eben')
    expect(formatAge(ago(45 * SEC), T0)).not.toBe('gerade eben')
  })

  it('uses the singular where German needs it', () => {
    expect(formatAge(ago(60 * SEC), T0)).toBe('vor 1 Minute')
    expect(formatAge(ago(75 * MIN), T0)).toBe('vor 1 Stunde')
    expect(formatAge(ago(30 * HOUR), T0)).toBe('vor 1 Tag')
    expect(formatAge(ago(40 * DAY), T0)).toBe('vor 1 Monat')
    expect(formatAge(ago(400 * DAY), T0)).toBe('vor 1 Jahr')
  })

  it('steps through the units', () => {
    expect(formatAge(ago(5 * MIN), T0)).toBe('vor 5 Minuten')
    expect(formatAge(ago(3 * HOUR), T0)).toBe('vor 3 Stunden')
    expect(formatAge(ago(4 * DAY), T0)).toBe('vor 4 Tagen')
    expect(formatAge(ago(90 * DAY), T0)).toBe('vor 3 Monaten')
    expect(formatAge(ago(3 * 365 * DAY), T0)).toBe('vor 3 Jahren')
  })

  it('never counts forwards when the two clocks disagree', () => {
    // A user's machine running a few seconds ahead of the server is ordinary;
    // "in 3 Sekunden" on a card is not.
    expect(formatAge(T0 + 3 * SEC, T0)).toBe('gerade eben')
    expect(formatAge(T0 + 5 * DAY, T0)).toBe('gerade eben')
  })

  it('is monotone: the older a prompt gets, the older it reads', () => {
    // The property a hand-written threshold ladder gets wrong: one typo and
    // some range reads YOUNGER than the range before it (46 days as "vor 1
    // Monat" while 40 days already said "vor 2 Monaten").
    const RANK = ['gerade eben', 'Minute', 'Minuten', 'Stunde', 'Stunden', 'Tag', 'Tagen',
      'Monat', 'Monaten', 'Jahr', 'Jahren']
    const UNIT: Record<string, number> = {
      'gerade eben': 0, Minute: 1, Minuten: 1, Stunde: 2, Stunden: 2,
      Tag: 3, Tagen: 3, Monat: 4, Monaten: 4, Jahr: 5, Jahren: 5,
    }
    const weigh = (label: string): [number, number] => {
      if (label === 'gerade eben') return [0, 0]
      const m = /^vor (\d+) (\S+)$/.exec(label)
      expect(m, `unbekanntes Format: ${label}`).not.toBeNull()
      return [UNIT[m![2]], Number(m![1])]
    }
    expect(RANK.every((r) => r in UNIT)).toBe(true)
    // Fine near the short thresholds, coarse over the long tail: a sweep of
    // the whole three years at seconds resolution costs seven seconds of CI
    // for ranges where nothing can change between two samples.
    let previous: [number, number] = [0, 0]
    const check = (d: number) => {
      const label = formatAge(ago(d), T0)
      const now = weigh(label)
      const forwards = now[0] > previous[0] || (now[0] === previous[0] && now[1] >= previous[1])
      expect(forwards, `${d / DAY} Tage: ${label}`).toBe(true)
      previous = now
    }
    for (let d = 0; d < 2 * DAY; d += 7 * SEC) check(d)
    for (let d = 2 * DAY; d < 3 * 365 * DAY; d += 3 * HOUR) check(d)
  })

  it('switches unit exactly at the documented thresholds', () => {
    const at = (d: number) => formatAge(ago(d), T0)
    const boundaries: [number, string, string][] = [
      [45 * SEC, 'gerade eben', 'vor 1 Minute'],
      [90 * SEC, 'vor 1 Minute', 'vor 2 Minuten'],
      [45 * MIN, 'vor 45 Minuten', 'vor 1 Stunde'],
      [90 * MIN, 'vor 1 Stunde', 'vor 2 Stunden'],
      [22 * HOUR, 'vor 22 Stunden', 'vor 1 Tag'],
      [36 * HOUR, 'vor 1 Tag', 'vor 2 Tagen'],
      [26 * DAY, 'vor 26 Tagen', 'vor 1 Monat'],
      [46 * DAY, 'vor 1 Monat', 'vor 2 Monaten'],
      [320 * DAY, 'vor 11 Monaten', 'vor 1 Jahr'],
      [548 * DAY, 'vor 1 Jahr', 'vor 2 Jahren'],
    ]
    for (const [edge, below, above] of boundaries) {
      expect(at(edge - 1), `${edge / SEC}s - 1ms`).toBe(below)
      expect(at(edge), `${edge / SEC}s`).toBe(above)
    }
  })
})

describe('promptTimes', () => {
  const created = '2026-06-01T10:00:00Z'

  it('judges an untouched prompt by its creation', () => {
    const t = promptTimes({ created_at: created, edited_at: created })
    expect(t.stamp).toBe(Date.parse(created))
    expect(t.edited).toBe(false)
    expect(t.title).toBe(`Erstellt: ${formatAbsolute(Date.parse(created))}`)
  })

  it('judges an edited prompt by the edit and says so', () => {
    const t = promptTimes({ created_at: created, edited_at: '2026-08-23T11:55:00Z' })
    expect(t.stamp).toBe(Date.parse('2026-08-23T11:55:00Z'))
    expect(t.edited).toBe(true)
    expect(t.title).toContain('Erstellt:')
    expect(t.title).toContain('Bearbeitet:')
  })

  it('does not call the write of a brand new prompt an edit', () => {
    // The row is written, then the event that stamps `edited_at` is recorded
    // microseconds later — the two timestamps are never byte-equal.
    const t = promptTimes({
      created_at: '2026-08-23T10:00:00.100000Z',
      edited_at: '2026-08-23T10:00:00.900000Z',
    })
    expect(t.edited).toBe(false)
  })

  it('falls back to created_at when the field is missing entirely', () => {
    // A response cached by the service worker before the field existed.
    const t = promptTimes({ created_at: created })
    expect(t.stamp).toBe(Date.parse(created))
    expect(t.edited).toBe(false)
  })

  it('reports nothing rather than NaN for an unusable timestamp', () => {
    const t = promptTimes({ created_at: 'kaputt', edited_at: null })
    expect(t.stamp).toBeNull()
    expect(t.title).toBe('')
    expect(promptAge({ created_at: 'kaputt' }, T0).text).toBe('')
  })
})
