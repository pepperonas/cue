/**
 * "vor 3 Stunden" — the age shown on every prompt.
 *
 * Pure by design: no clock of its own, no DOM. `now` is passed in, which is
 * what makes the thresholds testable and what lets one shared ticker
 * (`lib/clock.ts`) drive several hundred of these without each one owning a
 * timer.
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** A timestamp is treated as "now" until it is this old. */
export const JUST_NOW_MS = 45 * SECOND

/**
 * Parse an API timestamp to epoch millis, or null.
 *
 * A date-time string WITHOUT a zone designator is local time to every browser
 * (ES2015+), while the API means UTC — the difference is the viewer's offset,
 * i.e. two hours in Berlin, i.e. every prompt younger than two hours reading as
 * "gerade eben". The server now always sends the `Z` (see `_as_utc` in
 * `app/schemas.py`), but a response cached by the service worker before that
 * change does not, so the missing zone is still filled in here.
 */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  // SQLite's space separator, just in case something hands one through.
  const iso = value.trim().replace(' ', 'T')
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`
  const ms = Date.parse(zoned)
  return Number.isNaN(ms) ? null : ms
}

function plural(n: number, one: string, many: string): string {
  return `vor ${n} ${n === 1 ? one : many}`
}

/**
 * Format an age the way a video site does: coarse, human, never a date.
 *
 * The thresholds follow the ones day.js/moment settled on — they are tuned so
 * the label changes at moments that read as natural ("vor 45 Minuten" then
 * "vor 1 Stunde") rather than at exact multiples.
 */
export function formatAge(stamp: number, now: number): string {
  // Clock skew between the user's machine and the server is normal, so `diff`
  // can be negative. It needs no clamp: a negative value is below every
  // threshold and lands in "gerade eben" by construction — which is the right
  // answer and is pinned as behaviour below. (A `Math.max(0, …)` stood here
  // first and no mutation of it could be made to fail a test, because it never
  // changed an outcome.)
  const diff = now - stamp
  if (diff < JUST_NOW_MS) return 'gerade eben'
  if (diff < 90 * SECOND) return 'vor 1 Minute'
  if (diff < 45 * MINUTE) return plural(Math.round(diff / MINUTE), 'Minute', 'Minuten')
  if (diff < 90 * MINUTE) return 'vor 1 Stunde'
  if (diff < 22 * HOUR) return plural(Math.round(diff / HOUR), 'Stunde', 'Stunden')
  if (diff < 36 * HOUR) return 'vor 1 Tag'
  if (diff < 26 * DAY) return plural(Math.round(diff / DAY), 'Tag', 'Tagen')
  if (diff < 46 * DAY) return 'vor 1 Monat'
  if (diff < 320 * DAY) return plural(Math.round(diff / MONTH), 'Monat', 'Monaten')
  if (diff < 548 * DAY) return 'vor 1 Jahr'
  return plural(Math.round(diff / YEAR), 'Jahr', 'Jahren')
}

/** Absolute date for the tooltip — the exact truth behind the coarse label. */
export function formatAbsolute(stamp: number): string {
  return new Date(stamp).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** What a prompt's timestamps are worth showing. */
export interface PromptTimes {
  /** Epoch millis of the moment being described, or null if unparseable. */
  stamp: number | null
  /** Tooltip: both absolute timestamps, spelled out. */
  title: string
  /** True when the content was written after creation — the label is an EDIT. */
  edited: boolean
}

/**
 * The one place that decides which timestamp a prompt is judged by.
 *
 * `edited_at` when present, `created_at` otherwise — which is also what
 * `edited_at` IS for a prompt nobody has touched, so the fallback is not a
 * guess but the same value. Anything a client of an older build cached without
 * the field therefore still reads correctly.
 *
 * Deliberately free of `now`: the parts that do not change over time are
 * computed once per prompt, so the ticking clock only ever has to re-derive
 * the label itself.
 */
export function promptTimes(prompt: {
  created_at: string
  edited_at?: string | null
}): PromptTimes {
  const created = parseTimestamp(prompt.created_at)
  const edited = parseTimestamp(prompt.edited_at) ?? created
  const stamp = edited ?? created
  if (stamp === null) return { stamp: null, title: '', edited: false }
  // A couple of seconds apart is the same save: the row is written, then the
  // event that stamps `edited_at` is recorded microseconds later.
  const wasEdited = created !== null && edited !== null && edited - created > 2 * SECOND
  const title =
    wasEdited && created !== null
      ? `Erstellt: ${formatAbsolute(created)}\nBearbeitet: ${formatAbsolute(stamp)}`
      : `Erstellt: ${formatAbsolute(stamp)}`
  return { stamp, title, edited: wasEdited }
}

/** `promptTimes` plus the label — for callers that are not React components. */
export function promptAge(
  prompt: { created_at: string; edited_at?: string | null },
  now: number,
): PromptTimes & { text: string } {
  const times = promptTimes(prompt)
  return { ...times, text: times.stamp === null ? '' : formatAge(times.stamp, now) }
}
