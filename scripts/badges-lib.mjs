/**
 * badges-lib.mjs — the pure half of the badge generator.
 *
 * Everything here is a plain function over text: no filesystem, no child
 * processes, no README. That split exists because the risky part of
 * `update-badges.mjs` is not the fetching, it is the PARSING — a regex over a
 * test runner's output that silently stops matching turns every badge into a
 * confident lie, and the badges are the first thing anyone reads.
 *
 * Tested in scripts/tests/badges-lib.test.mjs (`node --test`, no dependencies).
 */

// ---- source classification -------------------------------------------------

export const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.css', '.mjs'])
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '__pycache__',
  '.venv',
  'tests',
  '__tests__',
  'coverage',
])

/** Test files are excluded from LOC — a test suite is not the product. */
export function isTestFile(name) {
  return (
    /\.test\.[cm]?tsx?$/.test(name) ||
    /\.test\.mjs$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    name === 'conftest.py'
  )
}

/** Which LOC bucket an extension belongs to. */
export function languageOf(ext) {
  if (ext === '.py') return 'python'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.css') return 'css'
  return 'other'
}

/** Non-blank lines. Blank-line padding is formatting, not code. */
export function countCodeLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length
}

// ---- parsers over tool output ---------------------------------------------
//
// Each one throws with the tail of the output rather than returning a
// plausible-looking zero: a badge that reads "0 tests" is a bug report, a badge
// that reads a stale number is a lie nobody notices.

function fail(what, out) {
  throw new Error(`Could not parse ${what}:\n${String(out).slice(-400)}`)
}

/** `version="X.Y.Z"` in backend/app/main.py — the single source of the version. */
export function parseVersion(mainPy) {
  const m = mainPy.match(/version="(\d+\.\d+\.\d+)"/)
  if (!m) fail('backend/app/main.py version="X.Y.Z"', mainPy)
  return m[1]
}

/** `pytest --collect-only -q` tail: "155 tests collected in 0.42s". */
export function parsePytestCount(out) {
  const m = out.match(/(\d+)\s+tests?\s+collected/)
  if (!m) fail('pytest collection output', out)
  return Number(m[1])
}

/** `pytest --cov` terminal report: the TOTAL row's percentage. */
export function parsePytestCoverage(out) {
  const m = out.match(/^TOTAL\s+\d+\s+\d+\s+(\d+)%/m)
  if (!m) fail('pytest coverage TOTAL row', out)
  return Number(m[1])
}

/** `vitest --coverage` text reporter: the "All files" row. */
export function parseVitestCoverage(out) {
  const m = out.match(/^All files\s*\|\s*([\d.]+)/m)
  if (!m) fail('vitest coverage summary', out)
  return Math.round(Number(m[1]))
}

/**
 * `vitest list` prints one line per test. Counting `it(` in the sources instead
 * would miss skips and todos and count them wrong in loops.
 */
export function parseVitestList(out) {
  const count = out.split('\n').filter((line) => line.trim() !== '').length
  if (count === 0) fail('vitest list (no tests reported)', out)
  return count
}

/** `node --test` summary block: "# pass 12". */
export function parseNodeTestCount(out) {
  const m = out.match(/^# pass (\d+)$/m)
  if (!m) fail('node --test summary', out)
  const passed = Number(m[1])
  const failed = Number(out.match(/^# fail (\d+)$/m)?.[1] ?? 0)
  if (failed > 0) throw new Error(`node --test reported ${failed} failing test(s)`)
  return passed
}

/** Route decorators across the backend — the honest endpoint count. */
export function countEndpoints(pySource) {
  return (pySource.match(/^@(router|api|app)\.(get|post|patch|put|delete)\(/gm) ?? []).length
}

/** SQLModel tables (`class X(SQLModel, table=True)`). */
export function countTables(modelsPy) {
  return (modelsPy.match(/table=True/g) ?? []).length
}

// ---- badge rendering -------------------------------------------------------

/**
 * shields.io reads `<label>-<message>-<color>`, so a literal hyphen inside a
 * label or value splits the badge apart and the URL 404s. It has to be doubled
 * BEFORE encoding (`encodeURIComponent` leaves hyphens alone). Escaping here
 * means no future badge can trip over it.
 */
export function shieldEscape(text) {
  return String(text).replace(/-/g, '--')
}

export function badge(label, value, color, link = '#', logo) {
  const path =
    `${encodeURIComponent(shieldEscape(label))}` +
    `-${encodeURIComponent(shieldEscape(value))}-${color}.svg`
  const query = logo ? `?logo=${encodeURIComponent(logo)}&logoColor=white` : ''
  return `[![${label}](https://img.shields.io/badge/${path}${query})](${link})`
}

/** Traffic light for a percentage. */
export function covColor(pct) {
  return pct >= 90 ? 'brightgreen' : pct >= 75 ? 'green' : 'yellow'
}

// ---- marker blocks ---------------------------------------------------------

/** The exact marker pair a generated block lives between. */
export function markerRegex(name) {
  return new RegExp(`<!-- ${name} -->[\\s\\S]*?<!-- /${name} -->`)
}

export function wrapBlock(name, body) {
  return `<!-- ${name} -->\n${body}\n<!-- /${name} -->`
}

/**
 * Replace a generated block in place.
 *
 * Throws when the markers are missing rather than appending: silently growing a
 * second copy of the badges at the end of the README is worse than a red build.
 */
export function replaceMarkedBlock(text, name, body) {
  const re = markerRegex(name)
  if (!re.test(text)) {
    throw new Error(`README.md: <!-- ${name} --> marker block not found`)
  }
  return text.replace(re, wrapBlock(name, body))
}
