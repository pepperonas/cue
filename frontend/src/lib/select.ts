/**
 * The rules behind the custom dropdown, free of React and of the DOM.
 *
 * They live here for the same reason `live-sync.ts` does: a listbox is mostly
 * decision-making — which row a key moves to, which row a typed prefix finds,
 * which side of the trigger the menu opens on — and none of that is observable
 * from a rendered component without a browser. The component carries the
 * result out; this file is what the tests hold.
 */

export interface Choice<V = string> {
  value: V
  label: string
  /** Ein farbiger Punkt wie an den Projekt-Chips. */
  dot?: string
  /** Ein Material-Symbol wie an den Status-Chips. */
  icon?: string
  /** Klasse am Symbol, z. B. die Status-Tönung `st-running`. */
  iconClass?: string
}

/**
 * Wohin eine Taste die Markierung bewegt. `null` = nicht unsere Taste.
 *
 * ⚠️ Bewusst OHNE Umlauf an den Enden: ein natives `<select>` bleibt dort
 * stehen, und das ist die Erwartung, die alle mitbringen. Ein Umlauf führte
 * beim Halten der Pfeiltaste endlos im Kreis.
 */
export function nextIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowDown':
      return Math.min(last, current + 1)
    case 'ArrowUp':
      return Math.max(0, current - 1)
    case 'Home':
      return 0
    case 'End':
      return last
    case 'PageDown':
      return Math.min(last, current + 10)
    case 'PageUp':
      return Math.max(0, current - 10)
    default:
      return null
  }
}

/**
 * Die Zeile, die eine getippte Folge findet — die Sprungsuche des nativen
 * `<select>`, nachgebaut.
 *
 * Zwei Fälle, und sie sind wirklich verschieden:
 * - **Dieselbe Taste mehrfach** („aaa") heißt „zeig mir den NÄCHSTEN Eintrag
 *   mit a", also wird ab `from + 1` gesucht und umgelaufen.
 * - **Ein wachsendes Wort** („pro", „proj") heißt „finde das, was so anfängt",
 *   also wird von vorn gesucht — sonst verlöre man beim zweiten Buchstaben den
 *   Treffer, den der erste gerade gefunden hat.
 */
export function typeAheadIndex(labels: string[], buffer: string, from: number): number | null {
  if (!buffer) return null
  const zeichen = [...buffer]
  const wiederholt = zeichen.every((c) => c === zeichen[0])
  const needle = (wiederholt ? zeichen[0] : buffer).toLowerCase()
  const start = wiederholt ? from + 1 : 0
  for (let step = 0; step < labels.length; step++) {
    const i = (start + step + labels.length) % labels.length
    if (labels[i].toLowerCase().startsWith(needle)) return i
  }
  return null
}

/** Wie lange eine getippte Folge als EIN Suchwort gilt (wie im nativen Feld). */
export const TYPE_AHEAD_MS = 700

export interface TypeBuffer {
  text: string
  at: number
}

/**
 * Den Puffer der Sprungsuche fortschreiben.
 *
 * Innerhalb des Fensters wächst die Folge, danach beginnt sie neu — sonst
 * suchte der erste Buchstabe eines neuen Wortes noch mit dem alten davor.
 *
 * ⚠️ `now` kommt von AUSSEN, aus `event.timeStamp`: die Zeit gehört zum
 * Tastendruck, nicht zum Augenblick der Auswertung. Das macht die Regel
 * prüfbar und erspart den unreinen Aufruf im Rumpf der Komponente.
 */
export function typeAheadBuffer(prev: TypeBuffer, key: string, now: number): TypeBuffer {
  return { text: now - prev.at > TYPE_AHEAD_MS ? key : prev.text + key, at: now }
}

export type Placement = 'below' | 'above'

export interface Placed {
  top: number
  maxHeight: number
  placement: Placement
}

/**
 * Auf welcher Seite des Auslösers das Menü aufgeht und wie hoch es werden darf.
 *
 * Unten, solange es dort passt — das ist die Leserichtung. Sonst oben. Passt es
 * nirgends ganz, gewinnt die größere Seite und das Menü scrollt in sich; ein
 * Menü, das aus dem Fenster ragt, ist die einzige Variante, die es nicht geben
 * darf. Deshalb liefert die Funktion `maxHeight` mit: die Höhe ist Teil der
 * Platzierungsentscheidung, nicht etwas, das die Anzeige danach noch korrigiert.
 */
export function placeMenu(
  trigger: { top: number; bottom: number },
  wanted: number,
  viewportHeight: number,
  { gap = 6, margin = 8, min = 96 }: { gap?: number; margin?: number; min?: number } = {},
): Placed {
  const unten = viewportHeight - trigger.bottom - gap - margin
  const oben = trigger.top - gap - margin
  const placement: Placement = wanted <= unten || unten >= oben ? 'below' : 'above'
  const platz = placement === 'below' ? unten : oben
  const maxHeight = Math.max(min, Math.min(wanted, platz))
  const top = placement === 'below' ? trigger.bottom + gap : trigger.top - gap - maxHeight
  // Nie über den oberen Rand hinaus — bei sehr kleinen Fenstern kann die
  // Mindesthöhe den berechneten Platz überschreiten.
  return { top: Math.max(margin, top), maxHeight, placement }
}
