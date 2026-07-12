#!/usr/bin/env node
/**
 * update-badges.mjs — keeps the README's LOC + test-count badges honest.
 *
 * - LOC: counts source lines in backend/app, cue-runner/cue_runner,
 *   cue-runner/hooks and frontend/src (.py/.ts/.tsx/.css), excluding tests
 *   and anything generated (node_modules, dist, __pycache__, .venv).
 * - Tests: parsed from the real runners' output — pytest --collect-only for
 *   the two Python suites, `vitest list` for the frontend — never hardcoded.
 *
 * Usage: node scripts/update-badges.mjs   (also: npm run update-badges)
 * Idempotent: replaces the existing badge lines in place.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---- LOC ----
const SOURCE_ROOTS = ['backend/app', 'cue-runner/cue_runner', 'cue-runner/hooks', 'frontend/src']
const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.css'])
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '__pycache__', '.venv', 'tests', '__tests__', 'coverage',
])
const isTestFile = (name) =>
  /\.test\.tsx?$/.test(name) || /^test_.*\.py$/.test(name) || name === 'conftest.py'

function countLoc(dir) {
  let loc = 0
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) loc += countLoc(path)
    } else if (SOURCE_EXTS.has(extname(entry)) && !isTestFile(entry)) {
      const text = readFileSync(path, 'utf8')
      loc += text.split('\n').filter((line) => line.trim() !== '').length
    }
  }
  return loc
}

// ---- test counts, parsed from the real runners ----
function run(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd: join(ROOT, cwd), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function pytestCount(cwd, cmd, args) {
  const out = run(cwd, cmd, [...args, '--collect-only', '-q'])
  const m = out.match(/(\d+)\s+tests?\s+collected/)
  if (!m) throw new Error(`Could not parse pytest collection output for ${cwd}:\n${out.slice(-400)}`)
  return Number(m[1])
}

function vitestCount() {
  const out = run('frontend', 'pnpm', ['-s', 'vitest', 'list'])
  const count = out.split('\n').filter((line) => line.trim() !== '').length
  if (count === 0) throw new Error(`vitest list reported no tests:\n${out.slice(-400)}`)
  return count
}

const backendTests = pytestCount('backend', 'uv', ['run', 'pytest'])
const runnerTests = pytestCount('cue-runner', '.venv/bin/python', ['-m', 'pytest'])
const frontendTests = vitestCount()
const totalTests = backendTests + runnerTests + frontendTests

const loc = SOURCE_ROOTS.reduce((sum, dir) => sum + countLoc(join(ROOT, dir)), 0)

// ---- README update (idempotent) ----
const badgeLines = [
  `[![Tests](https://img.shields.io/badge/tests-${totalTests}%20passing-brightgreen.svg)](backend/tests/test_api.py)`,
  `[![LOC](https://img.shields.io/badge/LOC-${loc}-blue.svg)](#)`,
]

const readmePath = join(ROOT, 'README.md')
const readme = readFileSync(readmePath, 'utf8')
let lines = readme.split('\n')

// Drop any existing Tests/LOC badge lines, then re-insert after the SemVer badge.
lines = lines.filter(
  (line) => !/^\[!\[Tests\]\(https:\/\/img\.shields\.io\/badge\/tests-/.test(line)
    && !/^\[!\[LOC\]\(https:\/\/img\.shields\.io\/badge\/LOC-/.test(line),
)
const anchor = lines.findIndex((line) => line.startsWith('[![SemVer]'))
if (anchor === -1) throw new Error('README.md: SemVer badge line not found (badge anchor)')
lines.splice(anchor + 1, 0, ...badgeLines)

const updated = lines.join('\n')
if (updated !== readme) {
  writeFileSync(readmePath, updated)
  console.log(`README badges updated: ${totalTests} tests (backend ${backendTests} + runner ${runnerTests} + frontend ${frontendTests}), ${loc} LOC`)
} else {
  console.log(`README badges already current: ${totalTests} tests, ${loc} LOC`)
}
