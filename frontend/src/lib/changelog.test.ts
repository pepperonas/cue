import { describe, expect, it } from 'vitest'
import { entryFor, parseChangelog } from './changelog'

const DOC = `# Changelog

All notable changes are documented here.

## [0.60.0] - 2026-09-01

### Added
- **Über cue** unter Einstellungen — Version, Entwickler, Spenden,
  Bewertung und ein aufklappbarer Changelog.
- Version im Footer.

### Fixed
- Ein Ding, das kaputt war.

## [0.59.1] - 2026-08-31

### Documentation
- Nur Doku.

## [0.1.0] - 2026-07-14
`

describe('parseChangelog', () => {
  it('reads every release in the order the file has them', () => {
    // Die Reihenfolge wird NICHT hier hergestellt: dass die Datei
    // neueste-zuerst ist, pinnt bereits test_docs.py. Zwei Stellen, die
    // dieselbe Ordnung erzeugen, können sich widersprechen.
    const out = parseChangelog(DOC)
    expect(out.map((e) => e.version)).toEqual(['0.60.0', '0.59.1', '0.1.0'])
  })

  it('keeps the date as written', () => {
    expect(parseChangelog(DOC)[0].date).toBe('2026-09-01')
  })

  it('groups the items by change type', () => {
    const [newest] = parseChangelog(DOC)
    expect(newest.groups.map((g) => g.kind)).toEqual(['Added', 'Fixed'])
    expect(newest.groups[1].items).toEqual(['Ein Ding, das kaputt war.'])
  })

  it('joins a wrapped bullet back into one item', () => {
    // ⚠️ Fast jeder Eintrag dieser Datei ist umbrochen. Ohne diese Regel
    // zerfiele der halbe Changelog in Satzfragmente.
    const [newest] = parseChangelog(DOC)
    expect(newest.groups[0].items[0]).toBe(
      '**Über cue** unter Einstellungen — Version, Entwickler, Spenden, Bewertung und ein aufklappbarer Changelog.',
    )
    expect(newest.groups[0].items).toHaveLength(2)
  })

  it('ignores the preamble above the first release', () => {
    // Titel und Erklärtext gehören zu keiner Version.
    const out = parseChangelog(DOC)
    expect(JSON.stringify(out)).not.toContain('All notable changes')
  })

  it('accepts a release with no entries yet', () => {
    // Die allererste Version hat in dieser Datei keinen Rumpf — sie darf
    // trotzdem nicht verschwinden. (Erwartung hier zuerst falsch getippt: die
    // Fixture hat sehr wohl ein Datum, nur keine Gruppen.)
    expect(parseChangelog(DOC)[2]).toEqual({
      version: '0.1.0',
      date: '2026-07-14',
      groups: [],
    })
  })

  it('accepts a heading without a date', () => {
    const out = parseChangelog('## [1.2.3]\n### Added\n- x\n')
    expect(out[0]).toMatchObject({ version: '1.2.3', date: '' })
  })

  it('does not lose a bullet that has no ### heading above it', () => {
    // Kommt selten vor, wäre aber ein still verschluckter Eintrag.
    const out = parseChangelog('## [1.0.0] - 2026-01-01\n- Ein loser Punkt\n')
    expect(out[0].groups).toEqual([{ kind: '', items: ['Ein loser Punkt'] }])
  })

  it('is empty for text that has no releases', () => {
    expect(parseChangelog('# Changelog\n\nNoch nichts.\n')).toEqual([])
    expect(parseChangelog('')).toEqual([])
  })

  it('is not confused by an Unreleased heading', () => {
    // `## [Unreleased]` ist kein Release und hat keine Versionsnummer.
    const out = parseChangelog('## [Unreleased]\n- x\n## [1.0.0] - 2026-01-01\n- y\n')
    expect(out.map((e) => e.version)).toEqual(['1.0.0'])
  })
})

describe('entryFor', () => {
  it('finds the section of a version', () => {
    expect(entryFor(parseChangelog(DOC), '0.59.1')?.date).toBe('2026-08-31')
  })

  it('returns undefined for a version that is not in the file', () => {
    // Genau der Fall, den der Vertragstest verbietet — die Anzeige muss ihn
    // trotzdem überleben, statt beim Öffnen zu werfen.
    expect(entryFor(parseChangelog(DOC), '9.9.9')).toBeUndefined()
  })
})
