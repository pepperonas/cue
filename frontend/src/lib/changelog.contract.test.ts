/**
 * Der Parser gegen den ECHTEN Changelog dieses Repositories.
 *
 * Das ist die Frontend-Hälfte der Hausregel „jede Änderung steht im
 * Changelog": `test_docs.py` prüft, dass die ausgelieferte Version dort einen
 * Abschnitt hat — dieser Test prüft zusätzlich, dass die App ihn auch
 * **anzeigen** kann. Ein Changelog, den der Parser nicht versteht, wäre in der
 * Oberfläche leer, ohne dass irgendetwas rot wird.
 *
 * Vorbild: BeatByte macht dasselbe in `about.rs` (`docs_stay_true`).
 */
import { describe, expect, it } from 'vitest'
import raw from '../../../CHANGELOG.md?raw'
import { entryFor, parseChangelog } from './changelog'
import { APP_VERSION } from './version'

const entries = parseChangelog(raw)

describe('the repository’s own CHANGELOG.md', () => {
  it('parses into releases', () => {
    expect(entries.length).toBeGreaterThan(50)
  })

  it('has an entry for the version this build ships', () => {
    // ⚠️ Das ist der Zwang: wer die Version anhebt und den Changelog vergisst,
    // bekommt hier einen roten Test — nicht erst eine leere Anzeige beim Nutzer.
    const entry = entryFor(entries, APP_VERSION)
    expect(entry, `CHANGELOG.md hat keinen Abschnitt für v${APP_VERSION}`).toBeDefined()
    expect(
      entry!.groups.length,
      `v${APP_VERSION} steht ohne Inhalt im Changelog`,
    ).toBeGreaterThan(0)
  })

  it('gives every release a date', () => {
    const undated = entries.filter((e) => !e.date).map((e) => e.version)
    expect(undated).toEqual([])
  })

  it('produces readable items, not fragments', () => {
    // Würden die Fortsetzungszeilen nicht zusammengezogen, bestünde der halbe
    // Changelog aus Satzresten. Ein Median über die echten Einträge ist der
    // einfachste Beleg, dass das noch funktioniert.
    const items = entries.flatMap((e) => e.groups.flatMap((g) => g.items))
    expect(items.length).toBeGreaterThan(100)
    const lengths = items.map((i) => i.length).sort((a, b) => a - b)
    expect(lengths[Math.floor(lengths.length / 2)]).toBeGreaterThan(40)
  })

  it('never emits a markdown list marker into an item', () => {
    const items = entries.flatMap((e) => e.groups.flatMap((g) => g.items))
    expect(items.filter((i) => /^[-*]\s/.test(i))).toEqual([])
  })
})
