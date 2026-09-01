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
  countHooks,
  countMigrations,
  countProviders,
  countReleases,
  countSchemas,
  countSettings,
  countTables,
  covColor,
  formatNumber,
  majorOf,
  isTestFile,
  languageOf,
  markerRegex,
  parseNodeTestCount,
  parsePytestCount,
  parsePytestCoverage,
  parseLatestReleaseDate,
  parseNpmDependency,
  parsePyDependency,
  parseRequiresPython,
  parseVersion,
  parseVitestCoverage,
  parseVitestList,
  relativeLinkTargets,
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

// ---------------------------------------------------------------------------
// dependency and project metadata
//
// These parsers replaced hand-typed badges ("React 18", "FastAPI 0.115"). The
// failure they guard against is silent by construction: nobody re-reads a
// badge they wrote themselves, so a version that drifts after an upgrade is a
// lie the README keeps telling.
// ---------------------------------------------------------------------------

describe('parseRequiresPython', () => {
  test('reads the floor', () => {
    assert.equal(parseRequiresPython('requires-python = ">=3.12"'), '3.12')
  })

  test('survives an upper bound and loose spacing', () => {
    assert.equal(parseRequiresPython('requires-python=">=3.11,<4.0"'), '3.11')
    assert.equal(parseRequiresPython('requires-python   =   ">= 3.13"'), '3.13')
  })

  test('throws instead of inventing a version', () => {
    // A badge reading "Python ?" is a bug report; one reading a made-up
    // version is a lie nobody checks.
    assert.throws(() => parseRequiresPython('[project]\nname = "x"'), /requires-python/)
  })
})

describe('parsePyDependency', () => {
  const PY = `dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "cryptography>=43.0",
]`

  test('reads a plain floor', () => {
    assert.equal(parsePyDependency(PY, 'fastapi'), '0.115')
  })

  test('reads through an extras marker', () => {
    // `uvicorn[standard]` is the shape half this file uses.
    assert.equal(parsePyDependency(PY, 'uvicorn'), '0.32')
  })

  test('does not match a package whose name merely starts the same', () => {
    // Asking for "crypto" must not answer with cryptography's version.
    assert.equal(parsePyDependency(PY, 'crypto'), null)
  })

  test('does not match a name that is the TAIL of another package', () => {
    // ⚠️ This is the case that needs the opening quote in the pattern, and the
    // prefix test above does NOT cover it: without the anchor, "dantic" finds
    // "pydantic>=2.9" and answers 2.9 for a package that is not there. Found by
    // mutation — the prefix test stayed green with the anchor removed.
    const py = 'dependencies = ["pydantic>=2.9"]'
    assert.equal(parsePyDependency(py, 'dantic'), null)
    assert.equal(parsePyDependency(py, 'pydantic'), '2.9')
  })

  test('returns null for something not listed', () => {
    assert.equal(parsePyDependency(PY, 'django'), null)
  })
})

describe('parseNpmDependency', () => {
  const PKG = JSON.stringify({
    dependencies: { react: '^18.3.1', '@tanstack/react-query': '~5.59.0' },
    devDependencies: { vitest: '2.1.9', typescript: '>=5.6.2' },
  })

  test('strips range markers', () => {
    assert.equal(parseNpmDependency(PKG, 'react'), '18.3.1')
    assert.equal(parseNpmDependency(PKG, '@tanstack/react-query'), '5.59.0')
    assert.equal(parseNpmDependency(PKG, 'typescript'), '5.6.2')
  })

  test('looks in devDependencies too', () => {
    // "Which Vitest is this" is as interesting as "which React is this".
    assert.equal(parseNpmDependency(PKG, 'vitest'), '2.1.9')
  })

  test('returns null for a missing package', () => {
    assert.equal(parseNpmDependency(PKG, 'vue'), null)
  })

  test('returns null for a specifier that carries no version', () => {
    // `workspace:*` and `link:../x` are real specifiers with nothing to show.
    const pkg = JSON.stringify({ dependencies: { shared: 'workspace:*' } })
    assert.equal(parseNpmDependency(pkg, 'shared'), null)
  })

  test('throws on a package.json that is not JSON', () => {
    assert.throws(() => parseNpmDependency('{ not json', 'react'), /package\.json/)
  })
})

describe('majorOf', () => {
  test('keeps the first segment', () => {
    assert.equal(majorOf('18.3.1'), '18')
    assert.equal(majorOf('5'), '5')
  })

  test('passes null through, so a missing package stays missing', () => {
    // Turning null into "null" would print a badge that reads "React null".
    assert.equal(majorOf(null), null)
  })
})

describe('countMigrations', () => {
  test('counts the additive column adds', () => {
    const db = `
        "a": "ALTER TABLE prompt ADD COLUMN a VARCHAR",
        "b": "ALTER TABLE prompt ADD COLUMN b INTEGER",
        "c": "ALTER TABLE user ADD COLUMN c BOOLEAN",`
    assert.equal(countMigrations(db), 3)
  })

  test('does not count prose about migrations', () => {
    assert.equal(countMigrations('# no Alembic, additive ALTER TABLE only'), 0)
  })
})

describe('countSettings', () => {
  test('counts each environment variable once', () => {
    const cfg = `
    a = os.environ.get("DB_PATH", "")
    b = os.environ.get("DB_PATH", "x")
    c = os.environ.get("SECRET_KEY", "")`
    assert.equal(countSettings(cfg), 2)
  })

  test('finds a name black wrapped onto the next line', () => {
    // ⚠️ THE trap this repo already documented once: a single-line pattern
    // under-reports and the badge quietly shrinks.
    const cfg = 'x = os.environ.get(\n        "ATTACHMENTS_DIR", "data/attachments"\n    )'
    assert.equal(countSettings(cfg), 1)
  })

  test('ignores lowercase dict lookups', () => {
    assert.equal(countSettings('cfg.get("timeout")'), 0)
  })
})

describe('countSchemas / countHooks / countProviders', () => {
  test('counts Pydantic models at the start of a line', () => {
    const py = 'class A(BaseModel):\n    x: int\n\nclass B(BaseModel):\n    y: int\n'
    assert.equal(countSchemas(py), 2)
    // A nested/indented class is not a top-level schema.
    assert.equal(countSchemas('    class Inner(BaseModel):'), 0)
  })

  test('counts exported hooks only', () => {
    const ts = 'export function useRoute() {}\nfunction useLocal() {}\nexport function helper() {}'
    assert.equal(countHooks(ts), 1)
  })

  test('counts registered providers', () => {
    const py = 'CLAUDE_CLI = ProviderSpec(\n)\nANTHROPIC_API = ProviderSpec(\n)\n'
    assert.equal(countProviders(py), 2)
  })
})

describe('changelog parsing', () => {
  const LOG = `# Changelog

## [0.58.0] - 2026-09-01
### Added
## [0.57.0] - 2026-09-01
## [0.1.0] - 2026-01-04
`

  test('counts every release', () => {
    assert.equal(countReleases(LOG), 3)
  })

  test('takes the date of the NEWEST entry', () => {
    // The file is newest-first (pinned by its own test), so the first match is
    // the release the badge should name.
    assert.equal(parseLatestReleaseDate(LOG), '2026-09-01')
  })

  test('ignores an Unreleased heading', () => {
    assert.equal(countReleases('## [Unreleased]\n## [1.0.0] - 2026-01-01\n'), 1)
  })

  test('throws when there is no dated release', () => {
    assert.throws(() => parseLatestReleaseDate('## [1.0.0]\n'), /CHANGELOG/)
  })
})

describe('formatNumber', () => {
  test('groups thousands', () => {
    assert.equal(formatNumber(30778), '30 778')
    assert.equal(formatNumber(1000), '1 000')
    assert.equal(formatNumber(1000000), '1 000 000')
  })

  test('leaves short numbers alone', () => {
    assert.equal(formatNumber(999), '999')
    assert.equal(formatNumber(0), '0')
  })
})

describe('badge options', () => {
  test('renders style and labelColor', () => {
    const out = badge('version', 'v1.0.0', 'blue', 'CHANGELOG.md', {
      style: 'for-the-badge',
      labelColor: '1a1c22',
    })
    assert.match(out, /style=for-the-badge/)
    assert.match(out, /labelColor=1a1c22/)
  })

  test('still accepts a bare logo string', () => {
    // The shorthand is the common case; breaking it would break every stack
    // badge at once.
    assert.match(badge('Python', '3.12', 'blue', '#', 'python'), /logo=python/)
  })

  test('combines a logo with a style', () => {
    const out = badge('X', 'y', 'blue', '#', { logo: 'react', style: 'flat-square' })
    assert.match(out, /logo=react/)
    assert.match(out, /style=flat-square/)
  })

  test('emits no query string when there is nothing to add', () => {
    assert.ok(!badge('X', 'y', 'blue').includes('?'))
  })
})

describe('relativeLinkTargets', () => {
  test('returns only targets a repository can verify', () => {
    const md = [
      '[a](docs/API.md)',
      '[b](https://example.com)',
      '[c](#anchor)',
      '[d](mailto:x@y.z)',
      '[e](SECURITY.md#threats)',
    ].join('\n')
    assert.deepEqual(relativeLinkTargets(md), ['docs/API.md', 'SECURITY.md'])
  })

  test('finds the broken link that once wedged the generator', () => {
    // A badge linking to ../SECURITY.md made update-badges unable to run: it
    // runs the backend suite, which checks README links, so it could not
    // rewrite the README that its own output had broken.
    assert.deepEqual(relativeLinkTargets('[x](../SECURITY.md)'), ['../SECURITY.md'])
  })

  test('is empty for text without links', () => {
    assert.deepEqual(relativeLinkTargets('no links here'), [])
  })
})
