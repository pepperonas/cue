#!/usr/bin/env node
/**
 * update-badges.mjs — keeps the README's DYNAMIC badges honest.
 *
 * Computed live, never hardcoded:
 * - Version: read from backend/app/main.py (`version="X.Y.Z"`).
 * - Tests: total + per suite, parsed from the real runners' output
 *   (pytest --collect-only for the two Python suites, `vitest list` for the
 *   frontend — counting it() occurrences would miss skips/todos).
 * - Coverage: backend + runner, parsed from `pytest --cov` TOTAL lines.
 * - LOC: source only (tests, node_modules, dist, generated files excluded),
 *   total plus Python/TypeScript split.
 * - API endpoints: route decorators counted across backend/app (routers + main).
 *
 * The badges live between the `<!-- badges:dynamic -->` markers in README.md
 * and are rewritten in place — idempotent, safe to run repeatedly.
 *
 * Usage: node scripts/update-badges.mjs   (also: npm run update-badges,
 * and automatically after `npm test` via the posttest hook)
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---- LOC (per language) ----
const SOURCE_ROOTS = ['backend/app', 'cue-runner/cue_runner', 'cue-runner/hooks', 'frontend/src']
const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.css', '.mjs'])
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '__pycache__', '.venv', 'tests', '__tests__', 'coverage',
])
const isTestFile = (name) =>
  /\.test\.tsx?$/.test(name) || /^test_.*\.py$/.test(name) || name === 'conftest.py'

function countLoc(dir, tally) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) countLoc(path, tally)
    } else if (SOURCE_EXTS.has(extname(entry)) && !isTestFile(entry)) {
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').length
      const ext = extname(entry)
      tally.total += lines
      if (ext === '.py') tally.python += lines
      else if (ext === '.ts' || ext === '.tsx') tally.typescript += lines
    }
  }
  return tally
}

// ---- runners ----
function run(cwd, cmd, args) {
  return execFileSync(cmd, args, {
    cwd: join(ROOT, cwd),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function pytestCount(cwd, cmd, args) {
  const out = run(cwd, cmd, [...args, '--collect-only', '-q'])
  const m = out.match(/(\d+)\s+tests?\s+collected/)
  if (!m) throw new Error(`Could not parse pytest collection output for ${cwd}:\n${out.slice(-400)}`)
  return Number(m[1])
}

function pytestCoverage(cwd, cmd, args, covTarget) {
  const out = run(cwd, cmd, [...args, '-q', `--cov=${covTarget}`, '--cov-report=term'])
  const m = out.match(/^TOTAL\s+\d+\s+\d+\s+(\d+)%/m)
  if (!m) throw new Error(`Could not parse coverage TOTAL for ${cwd}:\n${out.slice(-400)}`)
  return Number(m[1])
}

function vitestCount() {
  const out = run('frontend', 'pnpm', ['-s', 'vitest', 'list'])
  const count = out.split('\n').filter((line) => line.trim() !== '').length
  if (count === 0) throw new Error(`vitest list reported no tests:\n${out.slice(-400)}`)
  return count
}

// ---- version (single source: FastAPI app version) ----
function appVersion() {
  const main = readFileSync(join(ROOT, 'backend/app/main.py'), 'utf8')
  const m = main.match(/version="(\d+\.\d+\.\d+)"/)
  if (!m) throw new Error('backend/app/main.py: version="X.Y.Z" not found')
  return m[1]
}

// ---- API endpoint count (route decorators across the backend) ----
function endpointCount() {
  let count = 0
  const scan = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry)) scan(path)
      } else if (entry.endsWith('.py')) {
        const src = readFileSync(path, 'utf8')
        count += (src.match(/^@(router|api|app)\.(get|post|patch|put|delete)\(/gm) ?? []).length
      }
    }
  }
  scan(join(ROOT, 'backend/app'))
  return count
}

const covColor = (pct) => (pct >= 90 ? 'brightgreen' : pct >= 75 ? 'green' : 'yellow')

const version = appVersion()
const backendTests = pytestCount('backend', 'uv', ['run', 'pytest'])
const runnerTests = pytestCount('cue-runner', '.venv/bin/python', ['-m', 'pytest'])
const frontendTests = vitestCount()
const totalTests = backendTests + runnerTests + frontendTests
const backendCov = pytestCoverage('backend', 'uv', ['run', 'pytest'], 'app')
const runnerCov = pytestCoverage('cue-runner', '.venv/bin/python', ['-m', 'pytest'], 'cue_runner')
const loc = SOURCE_ROOTS.reduce(
  (t, dir) => countLoc(join(ROOT, dir), t),
  { total: 0, python: 0, typescript: 0 },
)
const endpoints = endpointCount()

const badge = (label, value, color, link = '#') =>
  `[![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(value)}-${color}.svg)](${link})`

const dynamicBlock = [
  '<!-- badges:dynamic -->',
  [
    badge('version', version, 'blue', 'CHANGELOG.md'),
    badge('tests', `${totalTests} passing`, 'brightgreen', 'backend/tests/'),
    badge('backend tests', String(backendTests), 'brightgreen', 'backend/tests/'),
    badge('runner tests', String(runnerTests), 'brightgreen', 'cue-runner/tests/'),
    badge('frontend tests', String(frontendTests), 'brightgreen', 'frontend/src/lib/'),
  ].join('\n'),
  [
    badge('coverage backend', `${backendCov}%`, covColor(backendCov), 'backend/tests/'),
    badge('coverage runner', `${runnerCov}%`, covColor(runnerCov), 'cue-runner/tests/'),
    badge('LOC', String(loc.total), 'blue'),
    badge('Python LOC', String(loc.python), '3776AB'),
    badge('TypeScript LOC', String(loc.typescript), '3178C6'),
    badge('API endpoints', String(endpoints), '8A2BE2', 'backend/app/routers/'),
  ].join('\n'),
  '<!-- /badges:dynamic -->',
].join('\n')

// ---- README update (idempotent, marker-based) ----
const readmePath = join(ROOT, 'README.md')
const readme = readFileSync(readmePath, 'utf8')
const markerRe = /<!-- badges:dynamic -->[\s\S]*?<!-- \/badges:dynamic -->/
if (!markerRe.test(readme)) {
  throw new Error('README.md: <!-- badges:dynamic --> marker block not found')
}
const updated = readme.replace(markerRe, dynamicBlock)

if (updated !== readme) {
  writeFileSync(readmePath, updated)
  console.log(
    `README badges updated: v${version}, ${totalTests} tests (be ${backendTests} / run ${runnerTests} / fe ${frontendTests}), ` +
    `cov be ${backendCov}% / run ${runnerCov}%, ${loc.total} LOC (py ${loc.python} / ts ${loc.typescript}), ${endpoints} endpoints`,
  )
} else {
  console.log(`README badges already current: v${version}, ${totalTests} tests, ${loc.total} LOC`)
}
