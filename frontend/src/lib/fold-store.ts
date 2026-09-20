/**
 * Was im Board auf- und zugeklappt ist — und zwar über das Neuladen hinweg.
 *
 * Zwei Zustände teilen sich dieses Modul, weil sie dieselbe Frage beantworten
 * („was habe ich hier offen gelassen") und vorher auf zwei verschiedene Arten
 * verloren gingen:
 *
 * - die **Spalten-Erweiterung** („+N weitere anzeigen") lebte in reinem
 *   React-Zustand und war nach jedem Neuladen weg;
 * - die **Mobil-Sektionen** lagen in `sessionStorage` und überlebten damit
 *   zwar F5, aber keinen neuen Tab.
 *
 * Beides liegt jetzt in `localStorage`, wie der Getestet-Aufklapper daneben.
 *
 * ⚠️ Wegräumen ist WAHLWEISE, und das ist keine Bequemlichkeit: bei der
 * Spalten-Erweiterung ist die Vorgabe immer „gedeckelt", ein Schlüssel auf
 * `false` also Müll. Bei den Sektionen hängt die Vorgabe dagegen von der
 * Kartenzahl ab (`defaultGroupsOpen` klappt ab 12 zu) — eine ausdrückliche
 * Wahl muss dort auch dann bleiben, wenn sie GERADE der Vorgabe entspricht,
 * sonst verschwände sie, sobald eine Karte dazukommt.
 */
export interface FoldState {
  [key: string]: boolean
}

/** Speicher, der auch fehlen darf — ein privates Fenster hat keinen. */
export interface FoldStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Die Erweiterung der Spalten und Gruppen („+N weitere anzeigen"). */
export const CAPS_KEY = 'cue-board-caps'
/** Die auf- und zugeklappten Sektionen der Mobilansicht. */
export const SECTIONS_KEY = 'cue-board-sections'

/**
 * Lesen, was gespeichert ist.
 *
 * Alles, was keine Wahrheitswerte-Tabelle ist, gilt als „nichts gespeichert" —
 * ein kaputter Eintrag (Hand angelegt, alte Fassung, halber Schreibvorgang)
 * darf das Board nicht mitreißen.
 */
export function loadFolds(storage: FoldStorage | null, key: string): FoldState {
  if (!storage) return {}
  try {
    const roh = JSON.parse(storage.getItem(key) || '{}') as unknown
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return {}
    const sauber: FoldState = {}
    for (const [k, v] of Object.entries(roh)) if (typeof v === 'boolean') sauber[k] = v
    return sauber
  } catch {
    return {}
  }
}

/**
 * Einen Schlüssel setzen und den neuen Zustand zurückgeben.
 *
 * Mit `fallback`: entspricht der Wert der Vorgabe, wird der Schlüssel ENTFERNT
 * statt geschrieben. Ohne: jede Wahl bleibt stehen — siehe die Warnung oben.
 */
export function withFold(
  state: FoldState,
  key: string,
  value: boolean,
  fallback?: boolean,
): FoldState {
  const next = { ...state }
  // Ohne `fallback` ist `value === fallback` nie wahr (ein Wahrheitswert ist
  // nie `undefined`) — eine zusätzliche Prüfung darauf wäre nur Zierde. Die
  // Mutationsprobe hat sie als No-Op entlarvt.
  if (value === fallback) delete next[key]
  else next[key] = value
  return next
}

/** Schreiben. Ein voller Speicher darf die Bedienung nicht anhalten. */
export function saveFolds(storage: FoldStorage | null, key: string, state: FoldState): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(state))
  } catch {
    /* Speicher voll oder gesperrt — der Zustand bleibt für diese Sitzung. */
  }
}

/**
 * Einen Zustand aus `sessionStorage` übernehmen, falls in `localStorage` noch
 * keiner steht.
 *
 * Die Mobil-Sektionen lagen bis 0.68.0 in `sessionStorage`. Ohne diesen Schritt
 * verlöre genau der Aufruf, der die Verbesserung bringt, den Zustand, den er
 * behalten soll.
 */
export function adoptLegacy(
  local: FoldStorage | null,
  session: FoldStorage | null,
  key: string,
): FoldState {
  const vorhanden = loadFolds(local, key)
  if (Object.keys(vorhanden).length > 0) return vorhanden
  const alt = loadFolds(session, key)
  if (Object.keys(alt).length > 0) saveFolds(local, key, alt)
  return alt
}
