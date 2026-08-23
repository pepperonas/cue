import { useMemo, useSyncExternalStore } from 'react'
import { clock } from '../lib/clock'
import { formatAge, promptTimes } from '../lib/relative-time'
import { Icon } from './ui'

interface Props {
  prompt: { created_at: string; edited_at?: string | null }
  className?: string
  /** Separator rendered ONLY when there is an age to show (list subline). */
  prefix?: string
}

/**
 * "vor 3 Stunden" — a prompt's age, kept current without a page reload.
 *
 * The label, and only the label, comes from the shared clock: subscribing to
 * the STRING rather than to the time means React compares "vor 3 Stunden" with
 * "vor 3 Stunden" and skips the render entirely. On a board of a few hundred
 * cards a tick therefore touches the handful whose wording actually moved on,
 * not all of them.
 *
 * A prompt that has been re-saved shows the age of that save (which is what
 * `edited_at` is) and says so with a pencil, so a months-old prompt reading
 * "vor 5 Minuten" does not look like a brand new one.
 */
export function RelativeTime({ prompt, className, prefix }: Props) {
  // Only the two timestamps matter; a fresh prompt object carrying the same
  // ones must not rebuild the tooltip on every render of the board.
  const { stamp, title, edited } = useMemo(
    () => promptTimes(prompt),
    [prompt.created_at, prompt.edited_at],
  )
  const text = useSyncExternalStore(clock.subscribe, () =>
    stamp === null ? '' : formatAge(stamp, clock.now()),
  )
  // An unusable timestamp renders nothing at all — including the separator,
  // which would otherwise leave the list subline ending in a bare "·".
  if (stamp === null) return null
  return (
    <>
      {prefix}
      <time
        className={`rel-time ${className ?? ''}`}
        dateTime={new Date(stamp).toISOString()}
        title={title}
        // The pencil is a ligature, i.e. the literal text "edit" to a screen
        // reader. The label replaces the whole node's reading with the sentence
        // a person would actually say.
        aria-label={edited ? `bearbeitet ${text}` : `erstellt ${text}`}
      >
        {edited && <Icon name="edit" />}
        {text}
      </time>
    </>
  )
}
