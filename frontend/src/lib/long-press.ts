/**
 * "Halten statt klicken" — die Regeln eines langen Drucks, ohne Browser.
 *
 * Framework- und DOM-frei, damit sie geprüft werden können: die riskanten
 * Stellen eines Long-Press sind nicht das Rendern, sondern die Buchführung —
 * genau einmal auslösen, den darauffolgenden Klick schlucken, und beim
 * nächsten Druck sauber von vorn beginnen. Genau derselbe Schnitt wie bei
 * `live-sync.ts`/`route.ts`: die Regeln hier, die React-Verdrahtung in
 * `state/long-press.ts`.
 */

/** Ab wann ein Druck als „lang" gilt. 500 ms ist der Plattformwert (Android
 *  `ViewConfiguration`, iOS), also das, was die Finger der Nutzer schon
 *  gelernt haben. */
export const LONG_PRESS_MS = 500

/** Wie weit der Finger dabei wandern darf, bevor es ein Wischen ist und kein
 *  Druck. 10 px liegt knapp über Androids Touch-Slop (~8 dp). */
export const LONG_PRESS_SLOP_PX = 10

export interface Point {
  x: number
  y: number
}

export interface LongPress {
  /** Zeiger unten — startet die Uhr. */
  start(point: Point): void
  /** Zeiger bewegt — jenseits des Slops wird abgebrochen. */
  move(point: Point): void
  /**
   * Zeiger oben.
   *
   * @returns ob dieser Druck bereits als langer ausgelöst hat — dann **muss**
   * der Aufrufer den folgenden `click` schlucken, sonst passiert beides.
   */
  end(): boolean
  /** Abbruch ohne Loslassen (`pointercancel`, Verlassen des Elements). */
  cancel(): void
}

export interface LongPressOptions {
  onLongPress: () => void
  delayMs?: number
  slopPx?: number
  /** Einspritzbar, damit Tests ohne Zeitgeber auskommen. */
  schedule?: (fn: () => void, ms: number) => number
  unschedule?: (id: number) => void
}

export function createLongPress({
  onLongPress,
  delayMs = LONG_PRESS_MS,
  slopPx = LONG_PRESS_SLOP_PX,
  schedule = (fn, ms) => window.setTimeout(fn, ms),
  unschedule = (id) => window.clearTimeout(id),
}: LongPressOptions): LongPress {
  let timer: number | null = null
  let origin: Point | null = null
  let fired = false

  const stopTimer = () => {
    if (timer === null) return
    unschedule(timer)
    timer = null
  }

  return {
    start(point) {
      stopTimer()
      // ⚠️ Jeder Druck beginnt sauber. Nach einem `pointercancel` folgt KEIN
      // Klick, der die Marke abholt — bliebe sie stehen, verschluckte sie den
      // Klick des NÄCHSTEN Drucks. Hier zurückzusetzen heißt: es gibt kein
      // Zurücksetzen, das man vergessen könnte.
      fired = false
      origin = point
      timer = schedule(() => {
        // Zuerst die Uhr abräumen: `onLongPress` darf denselben Zustand
        // anfassen, und ein Timer, der sich selbst noch für laufend hält,
        // wäre die Quelle eines zweiten Auslösens.
        timer = null
        fired = true
        onLongPress()
      }, delayMs)
    },

    move(point) {
      if (origin === null || timer === null) return
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      // Quadriert vergleichen — eine Wurzel je Zeigerbewegung ist nichts wert.
      if (dx * dx + dy * dy > slopPx * slopPx) stopTimer()
    },

    end() {
      stopTimer()
      return fired
    },

    cancel() {
      stopTimer()
    },
  }
}
