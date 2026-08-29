import { describe, expect, it } from 'vitest'
import { detailAction, type DetailKeyState } from './detail-keys'

const viewing: DetailKeyState = { editing: false }
const editing: DetailKeyState = { editing: true }

describe('detailAction', () => {
  it('copies, edits and restatuses while the prompt is being read', () => {
    expect(detailAction('c', viewing)).toEqual({ kind: 'copy' })
    expect(detailAction('e', viewing)).toEqual({ kind: 'edit' })
    expect(detailAction('1', viewing)).toEqual({ kind: 'status', status: 'queued' })
    expect(detailAction('2', viewing)).toEqual({ kind: 'status', status: 'running' })
    expect(detailAction('3', viewing)).toEqual({ kind: 'status', status: 'done' })
  })

  it('ignores keys it has no meaning for', () => {
    for (const key of ['x', '4', '0', 'Enter', ' ', 'C']) {
      expect(detailAction(key, viewing)).toBeNull()
    }
  })

  it('does NOTHING while the sheet is showing the form', () => {
    // The whole point of the module. Every key that means something in the
    // view has to be inert here — a stray `1` would move the prompt behind the
    // form to Queued, and `c` would overwrite the clipboard the user is
    // pasting FROM.
    for (const key of ['c', 'e', '1', '2', '3']) {
      expect(detailAction(key, editing)).toBeNull()
    }
  })

  it('gates on the state, not on a list of known keys', () => {
    // If the guard were written per key, a shortcut added later would arrive
    // unprotected. Anything that produces an action while viewing must produce
    // null while editing — asserted over the keys, not over a hard-coded set.
    const live = [...'abcdefghijklmnopqrstuvwxyz0123456789'].filter(
      (k) => detailAction(k, viewing) !== null,
    )
    expect(live.length).toBeGreaterThan(0) // the sweep actually found something
    for (const key of live) expect(detailAction(key, editing)).toBeNull()
  })
})
