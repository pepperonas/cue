// Shared within-column ordering for board/list views (tested in vitest).
import type { Prompt } from './types'

/** Ordering inside one status column:
 *  1. blocked prompts always sink to the very bottom,
 *  2. in DONE, tested prompts sink below untested ones and sort among
 *     themselves by execution time (most recently run first),
 *  3. everything else follows the drag order (sort_order, id). */
export function columnComparator(a: Prompt, b: Prompt): number {
  const blocked = Number(a.blocked) - Number(b.blocked)
  if (blocked) return blocked
  if (a.status === 'done' && b.status === 'done') {
    const tested = Number(a.tested) - Number(b.tested)
    if (tested) return tested
    if (a.tested && b.tested) {
      const ra = a.ran_at ? Date.parse(a.ran_at) : 0
      const rb = b.ran_at ? Date.parse(b.ran_at) : 0
      if (ra !== rb) return rb - ra // latest execution on top
    }
  }
  return a.sort_order - b.sort_order || a.id - b.id
}
