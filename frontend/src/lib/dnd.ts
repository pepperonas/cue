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
import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
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
