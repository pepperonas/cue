#!/usr/bin/env node
/**
 * update-badges.mjs — keeps the README's generated blocks honest.
 *
 * Nothing here is hardcoded; every number is computed from a real source:
 *
 *   version .......... backend/app/main.py (`version="X.Y.Z"`)
 *   tests ............ the real runners (pytest --collect-only, vitest list,
 *                      node --test) — counting `it(`/`def test_` in the sources
 *                      would miss skips, todos and loops
 *   coverage ......... pytest --cov TOTAL rows, vitest --coverage summary
 *   LOC .............. source only, per language (tests, node_modules, dist and
 *                      generated files excluded)
 *   endpoints ........ route decorators across backend/app
 *   tables ........... SQLModel `table=True` classes
 *   components ....... .tsx files under frontend/src/components
 *   docs ............. markdown pages
 *
 * Two blocks are rewritten in place, both idempotent:
 *   <!-- badges:dynamic -->  the badge wall
 *   <!-- tests:dynamic -->   the test-suite table
 *
 * The test table is generated for one reason: it used to be prose, and the
 * prose said "290 Tests" while the badges said 1038. Numbers a human has to
 * retype are numbers that rot.
 *
 * The parsing half lives in badges-lib.mjs and is unit tested; this file is the
 * shell that fetches and writes.
 *
 * Usage: node scripts/update-badges.mjs   (also `npm run update-badges`, and
 * automatically after `npm test` via the posttest hook)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXCLUDED_DIRS,
  SOURCE_EXTS,
  badge,
  countCodeLines,
  countEndpoints,
  countTables,
  covColor,
  isTestFile,
  languageOf,
  parseNodeTestCount,
  parsePytestCount,
  parsePytestCoverage,
  parseVersion,
  parseVitestCoverage,
  parseVitestList,
  replaceMarkedBlock,
} from './badges-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// ---- LOC (per language, source vs. test) ----
const SOURCE_ROOTS = ['backend/app', 'cue-runner/cue_runner', 'cue-runner/hooks', 'frontend/src']
const TEST_ROOTS = ['backend/tests', 'cue-runner/tests', 'frontend/src', 'scripts/tests']

function walk(dir, onFile) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) walk(path, onFile)
    } else {
      onFile(path, entry)
    }
  }
}

function sourceLoc() {
  const tally = { total: 0, python: 0, typescript: 0, css: 0 }
  for (const root of SOURCE_ROOTS) {
    walk(join(ROOT, root), (path, name) => {
      const ext = extname(name)
      if (!SOURCE_EXTS.has(ext) || isTestFile(name)) return
      const lines = countCodeLines(readFileSync(path, 'utf8'))
      tally.total += lines
      const bucket = languageOf(ext)
      if (bucket !== 'other') tally[bucket] += lines
    })
  }
  return tally
}

/** Test lines + files. `EXCLUDED_DIRS` holds "tests", so walk those roots directly. */
function testLoc() {
  const seen = new Set()
  let lines = 0
  let files = 0
  for (const root of TEST_ROOTS) {
    const dir = join(ROOT, root)
    const visit = (path, name) => {
      if (!isTestFile(name) || seen.has(path)) return
      seen.add(path)
      files += 1
      lines += countCodeLines(readFileSync(path, 'utf8'))
    }
    // Walk without the "tests" exclusion — that guard is for LOC, not for this.
    const walkAll = (d) => {
      if (!existsSync(d)) return
      for (const entry of readdirSync(d)) {
        const p = join(d, entry)
        if (statSync(p).isDirectory()) {
          if (!['node_modules', 'dist', '__pycache__', '.venv', 'coverage'].includes(entry)) walkAll(p)
        } else visit(p, entry)
      }
    }
    walkAll(dir)
  }
  return { lines, files }
}

function countFiles(dir, predicate) {
  let n = 0
  walk(join(ROOT, dir), (_path, name) => {
    if (predicate(name)) n += 1
  })
  return n
}

function backendSource() {
  let src = ''
  walk(join(ROOT, 'backend/app'), (path, name) => {
    if (name.endsWith('.py')) src += `${readFileSync(path, 'utf8')}\n`
  })
  return src
}

// ---- runners ----
function run(cwd, cmd, args) {
  return execFileSync(cmd, args, {
    cwd: join(ROOT, cwd),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const pytestCount = (cwd, cmd, args) =>
  parsePytestCount(run(cwd, cmd, [...args, '--collect-only', '-q']))

const pytestCoverage = (cwd, cmd, args, target) =>
  parsePytestCoverage(run(cwd, cmd, [...args, '-q', `--cov=${target}`, '--cov-report=term']))

/** Coverage of the pure lib modules only. Components and hooks are deliberately
 *  untested (see CLAUDE.md), so measuring all of src/ would report a number
 *  nobody intends to raise. */
const vitestCoverage = () =>
  parseVitestCoverage(
    run('frontend', 'pnpm', [
      '-s', 'vitest', 'run', '--coverage',
      '--coverage.include=src/lib/**', '--coverage.reporter=text',
    ]),
  )

const vitestCount = () => parseVitestList(run('frontend', 'pnpm', ['-s', 'vitest', 'list']))

/** `node --test` exits non-zero on failure, which execFileSync turns into a
 *  throw — the output is on the error, so read it from there. */
function scriptTestCount() {
  try {
    return parseNodeTestCount(run('.', 'node', ['--test', 'scripts/tests/']))
  } catch (err) {
    return parseNodeTestCount(err.stdout ?? '')
  }
}

// ---- collect ----
const version = parseVersion(read('backend/app/main.py'))
const backendTests = pytestCount('backend', 'uv', ['run', 'pytest'])
const runnerTests = pytestCount('cue-runner', '.venv/bin/python', ['-m', 'pytest'])
const frontendTests = vitestCount()
const scriptTests = scriptTestCount()
const totalTests = backendTests + runnerTests + frontendTests + scriptTests
const backendCov = pytestCoverage('backend', 'uv', ['run', 'pytest'], 'app')
const runnerCov = pytestCoverage('cue-runner', '.venv/bin/python', ['-m', 'pytest'], 'cue_runner')
const frontendCov = vitestCoverage()

const loc = sourceLoc()
const tests = testLoc()
const endpoints = countEndpoints(backendSource())
const tables = countTables(read('backend/app/models.py'))
const components = countFiles('frontend/src/components', (n) => n.endsWith('.tsx') && !isTestFile(n))
const docPages =
  countFiles('docs', (n) => n.endsWith('.md')) +
  readdirSync(ROOT).filter((n) => n.endsWith('.md')).length
const testRatio = Math.round((tests.lines / loc.total) * 100)

// ---- badge wall ----
const badgesBlock = [
  [
    badge('version', version, 'blue', 'CHANGELOG.md'),
    badge('tests', `${totalTests} passing`, 'brightgreen', 'docs/TESTING.md'),
    badge('backend tests', String(backendTests), 'brightgreen', 'backend/tests/'),
    badge('runner tests', String(runnerTests), 'brightgreen', 'cue-runner/tests/'),
    badge('frontend tests', String(frontendTests), 'brightgreen', 'frontend/src/lib/'),
    badge('script tests', String(scriptTests), 'brightgreen', 'scripts/tests/'),
  ].join('\n'),
  [
    badge('coverage backend', `${backendCov}%`, covColor(backendCov), 'backend/tests/'),
    badge('coverage runner', `${runnerCov}%`, covColor(runnerCov), 'cue-runner/tests/'),
    badge('coverage frontend-lib', `${frontendCov}%`, covColor(frontendCov), 'frontend/src/lib/'),
    badge('test files', String(tests.files), '0A9EDC', 'docs/TESTING.md'),
    badge('test LOC', String(tests.lines), '0A9EDC', 'docs/TESTING.md'),
    badge('test:code ratio', `${testRatio}%`, '0A9EDC', 'docs/TESTING.md'),
  ].join('\n'),
  [
    badge('LOC', String(loc.total), 'blue'),
    badge('Python LOC', String(loc.python), '3776AB'),
    badge('TypeScript LOC', String(loc.typescript), '3178C6'),
    badge('CSS LOC', String(loc.css), '663399'),
    badge('API endpoints', String(endpoints), '8A2BE2', 'docs/API.md'),
    badge('DB tables', String(tables), '003B57', 'docs/ARCHITECTURE.md'),
    badge('React components', String(components), '61DAFB', 'frontend/src/components/'),
    badge('docs pages', String(docPages), '4c1', 'docs/'),
  ].join('\n'),
].join('\n')

// ---- test-suite table ----
const suiteRow = (name, where, count, cov, what) =>
  `| ${name} | \`${where}\` | ${count} | ${cov} | ${what} |`

const testsBlock = [
  '| Suite | Ort | Tests | Coverage | Prüft |',
  '| --- | --- | --: | --: | --- |',
  suiteRow('Backend', 'backend/tests/', backendTests, `${backendCov} %`,
    'HTTP-Verhalten end-to-end gegen echtes tmp-SQLite: Auth/OAuth, Mandantentrennung, CRUD, Runs, Capture, Snippets, CSP'),
  suiteRow('Runner', 'cue-runner/tests/', runnerTests, `${runnerCov} %`,
    'Executor, Orchestrierungs-Schleifen, Stream-Parser, CLI-Delivery, API-Client — Subprozesse und Netz gemockt'),
  suiteRow('Frontend', 'frontend/src/lib/', frontendTests, `${frontendCov} %`,
    'die reinen Module: Markdown-XSS, Tags, Tastenlogik, Titel-Vervollständigung, Sortierung, Live-Sync, Farben'),
  suiteRow('Skripte', 'scripts/tests/', scriptTests, '—',
    'die Parser des Badge-Generators — damit kein Werkzeug-Output still danebenparst'),
  `| **Gesamt** | | **${totalTests}** | | |`,
].join('\n')

// ---- write ----
const readmePath = join(ROOT, 'README.md')
const before = readFileSync(readmePath, 'utf8')
let after = replaceMarkedBlock(before, 'badges:dynamic', badgesBlock)
after = replaceMarkedBlock(after, 'tests:dynamic', testsBlock)

const summary =
  `v${version}, ${totalTests} tests (be ${backendTests} / run ${runnerTests} / fe ${frontendTests} / scripts ${scriptTests}), ` +
  `cov be ${backendCov}% / run ${runnerCov}% / fe-lib ${frontendCov}%, ` +
  `${loc.total} LOC (py ${loc.python} / ts ${loc.typescript} / css ${loc.css}), ` +
  `${tests.files} test files, ${endpoints} endpoints, ${tables} tables, ${components} components, ${docPages} docs`

if (after !== before) {
  writeFileSync(readmePath, after)
  console.log(`README updated: ${summary}`)
} else {
  console.log(`README already current: ${summary}`)
}
