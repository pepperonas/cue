// Shared within-column ordering for board/list views (tested in vitest).
import type { Priority, Prompt } from './types'

/** How urgent a queued prompt is, as a sort rank: 0 high, 1 normal, 2 low.
 *
 *  Only the QUEUE is banded by it — urgency answers "what next", and a
 *  finished prompt that happened to be urgent must not shuffle the Done
 *  column. Mirror of `app/ordering.py:priority_rank`. */
export function priorityRank(prompt: Pick<Prompt, 'status' | 'priority'>): number {
  if (prompt.status !== 'queued') return 1
  if (prompt.priority === 'high') return 0
  if (prompt.priority === 'low') return 2
  return 1
}

/** Ordering inside one status column:
 *  1. blocked prompts always sink to the very bottom,
 *  2. in DONE, tested prompts sink below untested ones,
 *  3. in DONE, "genau testen" leads what is left,
 *  4. in QUEUED, higher priority comes first,
 *  5. everything else follows the drag order (sort_order, id).
 *
 *  The backend mirrors this in `app/ordering.py:display_key` so an anchored
 *  move ("put it before #42") means the same thing on both sides — see the
 *  note there. Only stored fields may take part, and every rule must be one
 *  the USER can override.
 *
 *  Tested prompts used to be ordered by `ran_at` among themselves. That made
 *  dragging them pointless: the move was saved and the next render put the
 *  card straight back, which read as "reordering isn't saved". Priority bands
 *  the queue the same way, and is allowed for the reason that rule was not:
 *  dragging across a band does bounce back, but the user can always raise the
 *  priority to get the card where they want it. */
export function columnComparator(a: Prompt, b: Prompt): number {
  const blocked = Number(a.blocked) - Number(b.blocked)
  if (blocked) return blocked
  if (a.status === 'done' && b.status === 'done') {
    const tested = Number(a.tested) - Number(b.tested)
    if (tested) return tested
    // "Genau testen" leads the Done column — that is where "what still needs
    // checking" is asked. Below the tested split on purpose: above it, a
    // marked AND already tested prompt would climb back out of the folded
    // block into the part that means "still to do".
    const close = Number(b.test_closely) - Number(a.test_closely)
    if (close) return close
  }
  const priority = priorityRank(a) - priorityRank(b)
  if (priority) return priority
  return a.sort_order - b.sort_order || a.id - b.id
}

/**
 * Next level in the cycle behind the board's priority toggle.
 *
 * Starts at the useful end: from the default one click makes a prompt urgent,
 * which is what people reach for. Going on demotes it and the third click
 * returns to normal, so the control is three clicks from anywhere and never a
 * dead end.
 */
export function nextPriority(current: Priority): Priority {
  if (current === 'normal') return 'high'
  if (current === 'high') return 'low'
  return 'normal'
}
