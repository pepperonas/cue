import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react'
import { createLongPress, type Point } from '../lib/long-press'

/**
 * Ein Knopf, zwei Gesten — die React-Hälfte von `lib/long-press.ts`.
 *
 * Der Hook sichert zu, dass je Druck **genau eine** der beiden Aktionen läuft;
 * das Schlucken des Klicks nach einem ausgelösten Halten passiert hier und
 * nicht im Aufrufer, weil genau das die Stelle ist, an der man es vergisst.
 */
export function usePress({
  onTap,
  onHold,
  delayMs,
}: {
  onTap: () => void
  onHold: () => void
  delayMs?: number
}) {
  // Aktuellste Rückrufe: `onHold` schließt über die momentane Priorität, der
  // Automat wird aber nur einmal gebaut.
  const latest = useRef({ onTap, onHold })
  latest.current = { onTap, onHold }

  const geschluckt = useRef(false)

  const press = useMemo(
    () => createLongPress({ onLongPress: () => latest.current.onHold(), delayMs }),
    [delayMs],
  )

  // Ausbau, während der Finger liegt: die Uhr darf nicht in eine verschwundene
  // Komponente hinein auslösen.
  useEffect(() => () => press.cancel(), [press])

  const punkt = (e: { clientX: number; clientY: number }): Point => ({ x: e.clientX, y: e.clientY })

  return {
    // Wie bisher: verhindert, dass der Druck auf dem Knopf einen Karten-Drag
    // startet.
    onPointerDown: (e: PointerEvent) => {
      e.stopPropagation()
      press.start(punkt(e))
    },
    onPointerMove: (e: PointerEvent) => press.move(punkt(e)),
    // ⚠️ Die Marke wird HIER gesetzt, nicht erst im Klick: `pointerup` kommt
    // vor `click`, und bliebe die Uhr laufen, löste ein langer Druck aus,
    // nachdem längst losgelassen wurde.
    onPointerUp: () => {
      geschluckt.current = press.end()
    },
    onPointerCancel: () => press.cancel(),
    onPointerLeave: () => press.cancel(),
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      if (geschluckt.current) {
        geschluckt.current = false
        return
      }
      latest.current.onTap()
    },
  }
}
