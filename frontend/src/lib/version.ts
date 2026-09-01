/**
 * Die Version dieses Builds.
 *
 * EINE Quelle: `version="X.Y.Z"` in `backend/app/main.py`. `vite.config.ts`
 * liest sie beim Bauen von dort und ersetzt `__APP_VERSION__` — es gibt keine
 * zweite, gepflegte Kopie in einem Manifest, und damit auch keine, die
 * auseinanderlaufen könnte. Schlägt das Lesen fehl, bricht der Build ab,
 * statt eine plausible Zahl auszuliefern.
 */
declare const __APP_VERSION__: string

export const APP_VERSION: string = __APP_VERSION__
