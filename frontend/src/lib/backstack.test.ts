import { describe, expect, it, vi } from 'vitest'
import { BackStack, isOverlayState } from './backstack'

describe('BackStack', () => {
  it('pushes one history entry per overlay', () => {
    const stack = new BackStack()
    expect(stack.push('a', () => {})).toEqual({ type: 'push' })
    expect(stack.push('b', () => {})).toEqual({ type: 'push' })
    expect(stack.ids).toEqual(['a', 'b'])
    // Re-registering the same instance must not add a second history record.
    expect(stack.push('b', () => {})).toEqual({ type: 'none' })
    expect(stack.size).toBe(2)
  })

  it('closes overlays LIFO on back navigation', () => {
    const stack = new BackStack()
    const closeA = vi.fn()
    const closeB = vi.fn()
    stack.push('a', closeA)
    stack.push('b', closeB)

    expect(stack.handlePop()).toBe(true)
    expect(closeB).toHaveBeenCalledOnce()
    expect(closeA).not.toHaveBeenCalled()

    expect(stack.handlePop()).toBe(true)
    expect(closeA).toHaveBeenCalledOnce()
    expect(stack.size).toBe(0)
  })

  it('reports an empty stack so the browser may leave the app', () => {
    expect(new BackStack().handlePop()).toBe(false)
  })

  it('steps back in history when the top overlay closes itself', () => {
    const stack = new BackStack()
    stack.push('a', () => {})
    expect(stack.remove('a')).toEqual({ type: 'back' })
    expect(stack.size).toBe(0)
  })

  it('never steps back twice for the same overlay', () => {
    const stack = new BackStack()
    const close = vi.fn()
    stack.push('a', close)
    // The user pressed back: the record is consumed by the browser itself …
    stack.handlePop()
    // … so the unmount that follows must NOT navigate again (that would leave
    // the app), and removing an unknown id is a no-op.
    expect(stack.remove('a')).toEqual({ type: 'none' })
  })

  it('does not navigate when a dialog underneath closes', () => {
    const stack = new BackStack()
    stack.push('a', () => {})
    stack.push('b', () => {})
    // 'a' closes while 'b' is still open — stepping back here would dismiss the
    // visible dialog instead.
    expect(stack.remove('a')).toEqual({ type: 'none' })
    expect(stack.ids).toEqual(['b'])
    // 'b' is top again and still owns a record.
    expect(stack.remove('b')).toEqual({ type: 'back' })
  })

  it('closeTop hits the newest overlay only', () => {
    const stack = new BackStack()
    const closeA = vi.fn()
    const closeB = vi.fn()
    stack.push('a', closeA)
    stack.push('b', closeB)
    expect(stack.closeTop()).toBe(true)
    expect(closeB).toHaveBeenCalledOnce()
    expect(closeA).not.toHaveBeenCalled()
    // closeTop leaves removal to the overlay's own close handler.
    expect(stack.size).toBe(2)
    expect(new BackStack().closeTop()).toBe(false)
  })

  it('survives three stacked overlays closing in mixed order', () => {
    const stack = new BackStack()
    const calls: string[] = []
    stack.push('sheet', () => calls.push('sheet'))
    stack.push('dialog', () => calls.push('dialog'))
    stack.push('confirm', () => calls.push('confirm'))

    stack.handlePop() // back -> confirm
    expect(stack.remove('dialog')).toEqual({ type: 'back' }) // ✕ on the dialog
    stack.handlePop() // back -> sheet
    expect(calls).toEqual(['confirm', 'sheet'])
    expect(stack.size).toBe(0)
  })

  it('recognises its own history entries', () => {
    expect(isOverlayState({ cueOverlay: 'detail' })).toBe(true)
    expect(isOverlayState({ other: 1 })).toBe(false)
    expect(isOverlayState(null)).toBe(false)
    expect(isOverlayState('x')).toBe(false)
  })
})
