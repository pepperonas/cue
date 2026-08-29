/**
 * What a bare keypress does while the detail sheet is open.
 *
 * This lives here, not in `App`, for the same reason `tag-keys.ts` does: the
 * interesting part is not that `c` copies, it is that **nothing at all fires
 * while the sheet is showing the form**. Editing happens inside the sheet now,
 * so the prompt behind the form is one keystroke away from being restatused or
 * copied over — and the `editable`-target guard does not catch it, because a
 * click on the sheet background moves focus off the textarea.
 *
 * A table is easy to extend without thinking about that; a table with a test
 * is not.
 */

export type DetailAction =
  | { kind: 'copy' }
  | { kind: 'edit' }
  | { kind: 'status'; status: 'queued' | 'running' | 'done' }
  | null

export interface DetailKeyState {
  /** The sheet is showing the form instead of the prompt. */
  editing: boolean
}

const STATUS_KEYS = {
  '1': 'queued',
  '2': 'running',
  '3': 'done',
} as const

export function detailAction(key: string, state: DetailKeyState): DetailAction {
  // One gate for every key, present and future. Deliberately not a per-key
  // check: the next shortcut someone adds inherits it for free.
  if (state.editing) return null
  if (key === 'c') return { kind: 'copy' }
  if (key === 'e') return { kind: 'edit' }
  const status = STATUS_KEYS[key as keyof typeof STATUS_KEYS]
  return status ? { kind: 'status', status } : null
}
