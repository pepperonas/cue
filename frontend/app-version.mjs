/**
 * Die Version dieses Builds und die Wurzel des Repositories.
 *
 * ⚠️ Diese Datei existiert, weil es ZWEI Konfigurationen gibt: `vite.config.ts`
 * (Bauen, Dev-Server) und `vitest.config.ts` (Tests) — und die zweite erbt
 * NICHTS von der ersten. Stünde die Ableitung in beiden, gäbe es zwei Stellen,
 * die die Version lesen, und damit zwei Stellen, die sich unterscheiden können.
 * Genau das soll die Einzelquelle ja verhindern.
 *
 * Die Quelle selbst ist `version="X.Y.Z"` in `backend/app/main.py`; gelesen
 * wird sie mit demselben Parser wie im Badge-Generator, der bei einer
 * unerwarteten Datei WIRFT — ein Build ohne erkennbare Version soll abbrechen
 * und keine plausible Zahl ausliefern.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion } from '../scripts/badges-lib.mjs'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const APP_VERSION = parseVersion(
  readFileSync(resolve(REPO_ROOT, 'backend/app/main.py'), 'utf8'),
)
