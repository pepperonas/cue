// Shared within-column ordering for board/list views (tested in vitest).
import type { Prompt } from './types'

/** Ordering inside one status column:
 *  1. blocked prompts always sink to the very bottom,
 *  2. in DONE, tested prompts sink below untested ones,
 *  3. everything else follows the drag order (sort_order, id).
 *
 *  The backend mirrors this in `app/ordering.py:display_key` so an anchored
 *  move ("put it before #42") means the same thing on both sides — see the
 *  note there. Only stored fields may take part, and every rule must be one a
 *  drag can still work within.
 *
 *  Tested prompts used to be ordered by `ran_at` among themselves. That made
 *  dragging them pointless: the move was saved and the next render put the
 *  card straight back, which read as "reordering isn't saved". */
export function columnComparator(a: Prompt, b: Prompt): number {
  const blocked = Number(a.blocked) - Number(b.blocked)
  if (blocked) return blocked
  if (a.status === 'done' && b.status === 'done') {
    const tested = Number(a.tested) - Number(b.tested)
    if (tested) return tested
  }
  return a.sort_order - b.sort_order || a.id - b.id
}
