/**
 * Unit tests for the badge generator's parsing half.
 *
 * `node --test`, no dependencies — this suite must run before anything is
 * installed, because its whole job is to catch the case where a tool changes
 * its output format and the badges quietly start reporting a stale or invented
 * number. A badge is the first thing anyone reads about this repo; a wrong one
 * is worse than none.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  badge,
  countCodeLines,
  countEndpoints,
  countTables,
  covColor,
  isTestFile,
  languageOf,
  markerRegex,
  parseNodeTestCount,
  parsePytestCount,
  parsePytestCoverage,
  parseVersion,
  parseVitestCoverage,
  parseVitestList,
  replaceMarkedBlock,
  shieldEscape,
  wrapBlock,
} from '../badges-lib.mjs'

describe('source classification', () => {
  test('recognises the test files of all three languages', () => {
    assert.equal(isTestFile('test_api.py'), true)
    assert.equal(isTestFile('conftest.py'), true)
    assert.equal(isTestFile('tags.test.ts'), true)
    assert.equal(isTestFile('Board.test.tsx'), true)
    assert.equal(isTestFile('badges-lib.test.mjs'), true)
  })

  test('does not mistake production code for a test', () => {
    // These are the near misses that would silently shrink the LOC badge.
    assert.equal(isTestFile('tags.ts'), false)
    assert.equal(isTestFile('latest.py'), false)
    assert.equal(isTestFile('protest.py'), false)
    assert.equal(isTestFile('testing.ts'), false)
  })

  test('buckets extensions by language', () => {
    assert.equal(languageOf('.py'), 'python')
    assert.equal(languageOf('.ts'), 'typescript')
    assert.equal(languageOf('.tsx'), 'typescript')
    assert.equal(languageOf('.css'), 'css')
    assert.equal(languageOf('.mjs'), 'other')
  })

  test('counts non-blank lines only', () => {
    assert.equal(countCodeLines('a\n\n  \nb\n'), 2)
    assert.equal(countCodeLines(''), 0)
  })
})

describe('parsing tool output', () => {
  test('reads the version from main.py', () => {
    assert.equal(parseVersion('app = FastAPI(\n  version="1.2.3",\n)'), '1.2.3')
  })

  test('refuses to guess a version', () => {
    assert.throws(() => parseVersion('app = FastAPI()'), /version="X.Y.Z"/)
  })

  test('reads a pytest collection count', () => {
    assert.equal(parsePytestCount('...\n459 tests collected in 0.62s\n'), 459)
    // A single test is grammatically different and still has to parse.
    assert.equal(parsePytestCount('1 test collected in 0.01s'), 1)
  })

  test('reads a pytest coverage TOTAL row', () => {
    const out = [
      'Name                 Stmts   Miss  Cover',
      '----------------------------------------',
      'app/main.py            120      3    98%',
      'TOTAL                 4210     84    98%',
    ].join('\n')
    assert.equal(parsePytestCoverage(out), 98)
  })

  test('does not mistake a module row for the TOTAL row', () => {
    // "app/total_helper.py" must not satisfy the anchored TOTAL pattern.
    const out = 'app/total_helper.py     10      0   100%\n'
    assert.throws(() => parsePytestCoverage(out), /coverage TOTAL/)
  })

  test('⚠️ reads the TOTAL ROW, not the first line that says TOTAL', () => {
    // The anchoring and the column shape are what make this right. A loose
    // /TOTAL.*?(\d+)%/ happily reports 90 here — and 90 vs 97 is the difference
    // between a green badge and a truthful one.
    const out = [
      'Coverage TOTAL must exceed 90% (project rule)',
      'Name          Stmts   Miss  Cover',
      'app/main.py     120      3    98%',
      'TOTAL          4210     84    97%',
    ].join('\n')
    assert.equal(parsePytestCoverage(out), 97)
  })

  test('reads and rounds a vitest coverage summary', () => {
    const out = [
      '% Coverage report from v8',
      'File      | % Stmts |',
      'All files |   95.62 |',
      ' lib      |   95.62 |',
    ].join('\n')
    assert.equal(parseVitestCoverage(out), 96)
  })

  test('counts vitest list lines and refuses an empty list', () => {
    assert.equal(parseVitestList('a > b\nc > d\n\n'), 2)
    assert.throws(() => parseVitestList('\n\n'), /no tests reported/)
  })

  test('reads the node --test summary', () => {
    const out = ['# tests 12', '# suites 4', '# pass 12', '# fail 0', '# cancelled 0'].join('\n')
    assert.equal(parseNodeTestCount(out), 12)
  })

  test('⚠️ never reports a green count while tests are failing', () => {
    const out = ['# tests 12', '# pass 10', '# fail 2'].join('\n')
    assert.throws(() => parseNodeTestCount(out), /2 failing/)
  })

  test('counts route decorators, not mentions of them', () => {
    const src = [
      '@router.get("/prompts")',
      'async def list_prompts(): ...',
      '@router.post("/prompts")',
      '@app.delete("/x")',
      '# @router.get("/commented-out") stays uncounted',
      'text = "@router.get(" # and so does a string',
    ].join('\n')
    assert.equal(countEndpoints(src), 3)
  })

  test('counts SQLModel tables', () => {
    assert.equal(countTables('class A(SQLModel, table=True):\nclass B(SQLModel, table=True):'), 2)
  })
})

describe('badge rendering', () => {
  test('doubles hyphens so shields.io does not split the badge apart', () => {
    // A single hyphen is the field separator in the badge URL — one raw hyphen
    // in a label and the image 404s.
    assert.equal(shieldEscape('coverage frontend-lib'), 'coverage frontend--lib')
    assert.match(badge('coverage frontend-lib', '96%', 'green'), /frontend--lib/)
  })

  test('encodes spaces and percent signs', () => {
    const out = badge('API endpoints', '90%', 'blue')
    assert.match(out, /API%20endpoints/)
    assert.match(out, /90%25/)
  })

  test('renders a markdown image link with the given target', () => {
    assert.equal(
      badge('version', '1.0.0', 'blue', 'CHANGELOG.md'),
      '[![version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)',
    )
  })

  test('adds a logo only when one is given', () => {
    assert.match(badge('Python', '3.12', 'blue', '#', 'python'), /\?logo=python&logoColor=white/)
    assert.ok(!badge('Python', '3.12', 'blue').includes('?'))
  })

  test('traffic-lights a percentage at the documented thresholds', () => {
    assert.equal(covColor(90), 'brightgreen')
    assert.equal(covColor(89), 'green')
    assert.equal(covColor(75), 'green')
    assert.equal(covColor(74), 'yellow')
  })
})

describe('marker blocks', () => {
  const readme = ['# cue', '', '<!-- badges:dynamic -->', 'OLD', '<!-- /badges:dynamic -->', '', 'text'].join('\n')

  test('replaces the block in place and leaves the rest alone', () => {
    const out = replaceMarkedBlock(readme, 'badges:dynamic', 'NEW')
    assert.match(out, /<!-- badges:dynamic -->\nNEW\n<!-- \/badges:dynamic -->/)
    assert.match(out, /^# cue/)
    assert.match(out, /text$/)
    assert.ok(!out.includes('OLD'))
  })

  test('is idempotent — running it twice changes nothing', () => {
    const once = replaceMarkedBlock(readme, 'badges:dynamic', 'NEW')
    assert.equal(replaceMarkedBlock(once, 'badges:dynamic', 'NEW'), once)
  })

  test('⚠️ throws instead of appending when the markers are gone', () => {
    // Appending would silently grow a second copy of the badges at the end of
    // the README; a red build is the better outcome.
    assert.throws(() => replaceMarkedBlock('# cue\n', 'badges:dynamic', 'NEW'), /marker block not found/)
  })

  test('keeps two different blocks apart', () => {
    const doc = [
      wrapBlock('badges:dynamic', 'B'),
      wrapBlock('tests:dynamic', 'T'),
    ].join('\n\n')
    const out = replaceMarkedBlock(doc, 'tests:dynamic', 'T2')
    assert.match(out, /<!-- badges:dynamic -->\nB\n/)
    assert.match(out, /<!-- tests:dynamic -->\nT2\n/)
  })

  test('the marker pattern is not greedy across blocks', () => {
    const doc = `${wrapBlock('a', '1')}\n${wrapBlock('b', '2')}`
    const [match] = doc.match(markerRegex('a'))
    assert.ok(!match.includes('<!-- b -->'))
  })
})
