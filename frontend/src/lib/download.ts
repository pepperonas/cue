/**
 * Eine Textdatei zum Herunterladen anbieten.
 *
 * Bewusst ohne Server: die Daten liegen längst im Browser, und ein Umweg über
 * eine Route würde für die Datei etwas anderes bauen als für die
 * Zwischenablage.
 */

/**
 * Wie lange die Objekt-URL gültig bleiben muss.
 *
 * ⚠️ Nicht sofort nach `click()` widerrufen: der Browser beginnt den Download
 * erst, nachdem die Ereignisschleife weiterläuft — eine bereits widerrufene URL
 * ergibt dann einen stillen Fehlschlag. Ein Tick reicht rechnerisch, eine
 * Sekunde ist die Reserve, die überall gilt.
 */
export const REVOKE_MS = 1000

export function saveTextFile(
  name: string,
  text: string,
  mime = 'application/json',
): boolean {
  let url = ''
  let a: HTMLAnchorElement | null = null
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    url = URL.createObjectURL(blob)
    a = document.createElement('a')
    a.href = url
    a.download = name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    return true
  } catch {
    return false
  } finally {
    // ⚠️ Aufräumen im `finally`, nicht in der Zeile nach dem Klick — dieselbe
    // Lehre wie in `clipboard.ts`: scheitert der Klick, bliebe sonst ein
    // unsichtbarer Anker in der Seite und die Objekt-URL hielte den Blob für
    // die Lebensdauer des Dokuments im Speicher fest.
    a?.remove()
    if (url) setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS)
  }
}
