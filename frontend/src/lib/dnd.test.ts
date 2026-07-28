import { describe, expect, it } from 'vitest'
import {
  MOUSE_DISTANCE_PX,
  TOUCH_DELAY_MS,
  TOUCH_TOLERANCE_PX,
  dragSelection,
} from './dnd'

describe('drag activation constraints', () => {
  it('keeps touch behind a press delay so the board can still be scrolled', () => {
    // Regression: a single PointerSensor with a distance constraint started a
    // drag on the first finger movement and made the board unscrollable.
    expect(TOUCH_DELAY_MS).toBeGreaterThanOrEqual(150)
    expect(TOUCH_TOLERANCE_PX).toBeGreaterThan(0)
    expect(MOUSE_DISTANCE_PX).toBeGreaterThan(0)
  })
})

describe('dragSelection', () => {
  const board = [10, 11, 12, 13, 14]

  it('drags a single card when nothing is selected', () => {
    expect(dragSelection(12, undefined, board)).toEqual([12])
    expect(dragSelection(12, [], board)).toEqual([12])
  })

  it('drags a single card when the grabbed one is not in the selection', () => {
    expect(dragSelection(12, [10, 11], board)).toEqual([12])
  })

  it('takes the whole selection when the grabbed card belongs to it', () => {
    expect(dragSelection(11, [11, 13], board)).toEqual([11, 13])
  })

  it('travels in board order, not in the order the boxes were ticked', () => {
    expect(dragSelection(14, [14, 10, 12], board)).toEqual([10, 12, 14])
  })

  it('ignores selected ids that are not on the board right now', () => {
    // Selected, then filtered away: it must not be dragged along invisibly.
    expect(dragSelection(11, [11, 99], board)).toEqual([11])
  })

  it('falls back to the single card for a selection of one', () => {
    expect(dragSelection(11, [11], board)).toEqual([11])
  })
})
