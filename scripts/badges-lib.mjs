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

// ---- dependency and project metadata ---------------------------------------
//
// These exist so the tech-stack badges stop being hand-typed. A badge that says
// "React 18" while package.json says 19 is not a small error: it is the README
// lying about the thing it exists to describe, and nobody notices because
// nobody re-reads a badge they wrote themselves.

/**
 * `requires-python = ">=3.12"` → "3.12".
 *
 * ⚠️ The closing quote is deliberately NOT required after the version: a real
 * specifier may carry an upper bound (`">=3.11,<4.0"`), and demanding the quote
 * made this throw on a perfectly valid file. Found by its own test.
 */
export function parseRequiresPython(pyproject) {
  const m = pyproject.match(/requires-python\s*=\s*["'][^\d]*([\d.]+)/)
  if (!m) fail('pyproject requires-python', pyproject)
  return m[1]
}

/**
 * The floor of a Python dependency: `fastapi>=0.115` → "0.115".
 *
 * Returns null for a package that is not listed — the caller decides whether a
 * missing dependency is a badge that disappears or an error.
 */
export function parsePyDependency(pyproject, name) {
  const re = new RegExp(`["']${name}(?:\\[[^\\]]*\\])?\\s*>=\\s*([\\d.]+)`, 'i')
  return pyproject.match(re)?.[1] ?? null
}

/**
 * A npm dependency's version, range markers stripped: `^18.3.1` → "18.3.1".
 *
 * Looks in dependencies AND devDependencies, because "which Vitest is this"
 * is exactly as interesting as "which React is this".
 */
export function parseNpmDependency(packageJsonText, name) {
  let pkg
  try {
    pkg = JSON.parse(packageJsonText)
  } catch {
    fail('package.json (not valid JSON)', packageJsonText)
  }
  const raw = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null
  if (raw === null) return null
  const m = String(raw).match(/(\d+(?:\.\d+)*)/)
  return m ? m[1] : null
}

/** Major version only — "18.3.1" → "18". Badges read better short. */
export function majorOf(version) {
  return version === null ? null : String(version).split('.')[0]
}

/** Idempotent `ALTER TABLE` statements in db.py — the schema's migration count. */
export function countMigrations(dbPy) {
  return (dbPy.match(/ALTER TABLE \w+ ADD COLUMN/g) ?? []).length
}

/**
 * Environment settings read in config.py.
 *
 * ⚠️ The newline matters: black wraps long calls, so `os.environ.get(` and the
 * name can sit on different lines — a single-line pattern under-reports and the
 * badge quietly shrinks (the same trap `test_docs.py` documents).
 */
export function countSettings(configPy) {
  return new Set(
    [...configPy.matchAll(/\.get\(\s*\n?\s*["']([A-Z_][A-Z0-9_]*)["']/g)].map((m) => m[1]),
  ).size
}

/** Pydantic request/response models. */
export function countSchemas(schemasPy) {
  return (schemasPy.match(/^class \w+\(BaseModel\)/gm) ?? []).length
}

/** Exported React hooks (`export function useX`). */
export function countHooks(source) {
  return (source.match(/export function use[A-Z]\w*/g) ?? []).length
}

/** Registered optimizer providers. */
export function countProviders(providersPy) {
  return (providersPy.match(/^\w+ = ProviderSpec\(/gm) ?? []).length
}

/** Every released version heading in the changelog. */
export function countReleases(changelog) {
  return (changelog.match(/^## \[\d+\.\d+\.\d+\]/gm) ?? []).length
}

/** Date of the newest release heading: "## [0.58.0] - 2026-09-01" → "2026-09-01". */
export function parseLatestReleaseDate(changelog) {
  const m = changelog.match(/^## \[\d+\.\d+\.\d+\]\s*-\s*(\d{4}-\d{2}-\d{2})/m)
  if (!m) fail('CHANGELOG release date', changelog)
  return m[1]
}

/** Thousands separators — a five-digit badge is hard to read without them. */
export function formatNumber(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
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

/**
 * One shields.io badge as a linked Markdown image.
 *
 * `opts` accepts a bare string as a shorthand for `{ logo }` — that is the
 * common case and reads better at the call site than an object of one key.
 */
export function badge(label, value, color, link = '#', opts = {}) {
  const { logo, style, labelColor } = typeof opts === 'string' ? { logo: opts } : opts
  const path =
    `${encodeURIComponent(shieldEscape(label))}` +
    `-${encodeURIComponent(shieldEscape(value))}-${color}.svg`
  const query = new URLSearchParams()
  if (logo) {
    query.set('logo', logo)
    query.set('logoColor', 'white')
  }
  if (style) query.set('style', style)
  if (labelColor) query.set('labelColor', labelColor)
  const qs = query.toString()
  return `[![${label}](https://img.shields.io/badge/${path}${qs ? `?${qs}` : ''})](${link})`
}

/** Traffic light for a percentage. */
export function covColor(pct) {
  return pct >= 90 ? 'brightgreen' : pct >= 75 ? 'green' : 'yellow'
}

/**
 * Relative link targets in a Markdown fragment — the ones a repo can verify.
 *
 * ⚠️ This exists because of a deadlock I walked into: `update-badges.mjs` runs
 * the backend suite to measure coverage, and that suite contains a test which
 * checks every link in the README. A badge written with a broken relative link
 * therefore makes the generator unable to run — it cannot rewrite the README
 * because the tests it runs first fail on the README it has not written yet.
 * Checking here means the mistake is caught where it is made, with the offending
 * target named, instead of two minutes later in an unrelated-looking failure.
 */
export function relativeLinkTargets(markdown) {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((t) => !/^(https?:\/\/|#|mailto:)/.test(t))
    .map((t) => t.split('#')[0])
    .filter(Boolean)
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
