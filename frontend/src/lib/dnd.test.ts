import { describe, expect, it } from 'vitest'
import {
  MOUSE_DISTANCE_PX,
  TOUCH_DELAY_MS,
  TOUCH_TOLERANCE_PX,
  boardCollision,
  dragSelection,
  columnIdOf,
  preferCard,
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

describe('preferCard', () => {
  it('picks the card over the column that contains it', () => {
    // Both are under the pointer; the card is the anchor a move needs.
    expect(preferCard([{ id: 'col:done' }, { id: 42 }])).toEqual([{ id: 42 }])
  })

  it('falls back to the column for the empty space below the last card', () => {
    expect(preferCard([{ id: 'col:queued' }])).toEqual([{ id: 'col:queued' }])
  })

  it('passes an empty result through', () => {
    expect(preferCard([])).toEqual([])
  })

  it('takes the first card when several are reported', () => {
    expect(preferCard([{ id: 'col:done' }, { id: 7 }, { id: 8 }])).toEqual([{ id: 7 }])
  })
})

describe('columnIdOf', () => {
  it('recognises a column droppable and returns its status', () => {
    expect(columnIdOf('col:done')).toBe('done')
    expect(columnIdOf('col:queued')).toBe('queued')
  })

  it('returns null for a card id, so a card is never mistaken for a column', () => {
    expect(columnIdOf(42)).toBeNull()
    // Mobile project groups use `<status>:<project>` — not a column droppable.
    expect(columnIdOf('done:12')).toBeNull()
  })
})

// ----------------------------------------------------------------------
// boardCollision — the hit testing itself. Only its construction was covered
// before, not a single one of the rules it exists for.
// ----------------------------------------------------------------------

function rect(left: number, top: number, width: number, height: number) {
  return { top, left, width, height, right: left + width, bottom: top + height }
}

/** A board of two columns whose heights differ wildly — the shape that broke
 *  corner-distance hit testing. Queued is short, Done is tall. */
function board() {
  const rects = new Map<number | string, ReturnType<typeof rect>>([
    ['col:queued', rect(0, 0, 300, 400)],
    [1, rect(10, 10, 280, 90)],
    [2, rect(10, 110, 280, 90)],
    ['col:done', rect(320, 0, 300, 1200)],
    [3, rect(330, 300, 280, 90)],
    [4, rect(330, 400, 280, 90)],
  ])
  return {
    droppableRects: rects,
    droppableContainers: [...rects.keys()].map((id) => ({ id })),
    cardsByColumn: { queued: [1, 2], done: [3, 4] },
  }
}

function collide(
  cardsByColumn: Record<string, number[]>,
  args: Record<string, unknown>,
) {
  // The real signature carries more than these tests need; dnd-kit only reads
  // the fields provided here.
  return boardCollision(cardsByColumn)(args as never)
}

describe('boardCollision', () => {
  it('never leaves the column the pointer is in', () => {
    // The 690px regression: dragging past the end of the SHORT column made a
    // card in the tall neighbour the nearest droppable by corner distance, so a
    // drag inside Queued silently moved the prompt to Done. The pointer sits in
    // Queued below its last card; the geometrically closest CARD centre belongs
    // to Done.
    const b = board()
    const hits = collide(b.cardsByColumn, {
      droppableRects: b.droppableRects,
      droppableContainers: b.droppableContainers,
      pointerCoordinates: { x: 150, y: 350 },
      collisionRect: rect(20, 320, 260, 60),
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(b.cardsByColumn.queued).toContain(hits[0].id as number)
  })

  it('anchors on a card when the pointer sits over one', () => {
    const b = board()
    const hits = collide(b.cardsByColumn, {
      droppableRects: b.droppableRects,
      droppableContainers: b.droppableContainers,
      pointerCoordinates: { x: 150, y: 150 },
      collisionRect: rect(20, 120, 260, 60),
    })
    // A card wins over its column: the move is expressed against a neighbour.
    expect(hits[0].id).toBe(2)
  })

  it('returns the column itself when it holds no cards', () => {
    // Otherwise there is no droppable at all and a drop into an empty column
    // would be a no-op.
    const b = board()
    const hits = collide(
      { queued: [], done: [3, 4] },
      {
        droppableRects: b.droppableRects,
        droppableContainers: b.droppableContainers,
        pointerCoordinates: { x: 150, y: 350 },
        collisionRect: rect(20, 320, 260, 60),
      },
    )
    expect(hits[0].id).toBe('col:queued')
  })

  it('still resolves a target without a pointer (keyboard drag)', () => {
    // `pointerWithin` returns nothing for a keyboard drag; the rect fallback
    // has to keep arrow-key reordering working.
    const b = board()
    const hits = collide(b.cardsByColumn, {
      droppableRects: b.droppableRects,
      droppableContainers: b.droppableContainers,
      pointerCoordinates: null,
      collisionRect: rect(10, 110, 280, 90),
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(b.cardsByColumn.queued).toContain(hits[0].id as number)
  })
})
