// Shared drag-and-drop sensor setup.
//
// Why not a single PointerSensor: pointer events cover touch as well, and with
// a distance activation constraint the very first finger movement over a
// draggable starts a drag — scrolling a board, a chip row or a snippet list on
// a phone became impossible. Splitting the input types fixes that:
//
//   MouseSensor    instant 6px threshold, unchanged desktop feel
//   TouchSensor    short press first, so a swipe scrolls and a hold drags
//   KeyboardSensor space/enter + arrows, the only way to reorder without a pointer
//
// Every dnd-kit call site in the app uses this hook, so the behaviour (and any
// future tuning) lives in exactly one place.
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/** Press duration before a touch turns into a drag. */
export const TOUCH_DELAY_MS = 200
/** Finger movement tolerated during the press without cancelling it. */
export const TOUCH_TOLERANCE_PX = 8
/** Mouse movement before a drag starts. */
export const MOUSE_DISTANCE_PX = 6

export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DISTANCE_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * Ids that travel with a drag, in board order.
 *
 * Grabbing a card that is part of a selection takes the whole selection along;
 * any other card travels alone. The order comes from `boardOrder` (the visible
 * ids top-to-bottom across the columns), NOT from the order the user ticked
 * the boxes — the block has to land the way it looked. Ids that aren't on the
 * board right now (selected, then filtered away) are dropped.
 */
export function dragSelection(
  activeId: number,
  selectedIds: number[] | undefined,
  boardOrder: number[],
): number[] {
  if (!selectedIds?.includes(activeId)) return [activeId]
  const picked = new Set(selectedIds)
  const travelling = boardOrder.filter((id) => picked.has(id))
  return travelling.length > 1 ? travelling : [activeId]
}

/**
 * Of all droppables under the pointer, a card wins over the column.
 *
 * A card is the ANCHOR a move is expressed against ("put it before #42");
 * the column only tells us WHICH list to anchor inside. Cards use numeric
 * ids, columns/sections use strings.
 */
export function preferCard<T extends { id: number | string }>(collisions: T[]): T[] {
  const card = collisions.find((c) => typeof c.id === 'number')
  return card ? [card] : collisions
}

/** Status behind a column droppable id (`col:done` -> `done`), else null. */
export function columnIdOf(id: number | string): string | null {
  return typeof id === 'string' && id.startsWith('col:') ? id.slice(4) : null
}

/**
 * Which droppable a board drag is over.
 *
 * Two problems this solves, both of which made drags land somewhere else than
 * the cursor pointed:
 *
 * 1. `closestCorners` measures corner distance, which falls apart when the
 *    columns differ wildly in height. Dragging a card past the end of a SHORT
 *    column made a card in the tall neighbour column the nearest droppable, so
 *    a drag inside "Queued" silently moved the prompt to "Done" — 690 px away
 *    from the cursor. The POINTER decides instead.
 * 2. The pointer often sits in the gap between two cards (they animate out of
 *    the way while dragging), where the only droppable under it is the column
 *    itself. Without an anchor card the drop became a no-op: the card sprang
 *    back and nothing was saved. So when the pointer resolves to a column, we
 *    pick the closest card WITHIN that column — never outside it.
 *
 * `cardsByColumn` is the board's current containers map.
 */
export function boardCollision(cardsByColumn: Record<string, number[]>): CollisionDetection {
  return (args) => {
    const under = pointerWithin(args)
    const hits = preferCard(under.length ? under : rectIntersection(args))
    const first = hits[0]
    if (!first) return hits
    const column = columnIdOf(first.id)
    if (column === null) return hits // already a card

    const ids = cardsByColumn[column] ?? []
    if (!ids.length) return hits // empty column: the column itself is the target
    const inside = closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => ids.includes(c.id as number)),
    })
    return inside.length ? inside : hits
  }
}
