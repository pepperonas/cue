import { useCallback, useState } from 'react'
import { TESTED_OPEN_KEY } from '../lib/board-groups'

function load(): boolean {
  try {
    return localStorage.getItem(TESTED_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Is the block of already-tested prompts in Done unfolded?
 *
 * Board and list view both call this. They are never mounted at the same time,
 * so each keeps its own React state and they meet in localStorage — which is
 * what makes the fold the same fold in both places rather than two settings
 * that happen to look alike.
 *
 * Default folded: the point is to get finished, checked work out of the way,
 * and defaulting to "open" would deliver nothing until the toggle is found.
 */
export function useTestedFold(): [boolean, () => void] {
  const [open, setOpen] = useState(load)
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(TESTED_OPEN_KEY, next ? '1' : '0')
      } catch {
        /* private mode / quota — the fold still works, it just forgets */
      }
      return next
    })
  }, [])
  return [open, toggle]
}
