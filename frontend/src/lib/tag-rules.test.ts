import { describe, expect, it } from 'vitest'
import { AUTO_TAG_LIMIT, autoTags, CURATED, deriveTags, ruleTargets } from './tag-rules'

describe('deriveTags', () => {
  it('reads the measured keywords out of a real title', () => {
    expect(autoTags('doku updaten')).toContain('documentation')
    expect(autoTags('theme wechsel fixen')).toContain('bugfix')
    expect(autoTags('stats ansicht animieren')).toContain('animation')
  })

  it('matches inside German compounds where the rule allows it', () => {
    // "hintergrundanimation" is one word in the corpus — a word-start match
    // would miss it entirely.
    expect(autoTags('db analyse hintergrundanimation optimieren')).toContain('animation')
  })

  it('does not match a stem buried inside an unrelated word', () => {
    // "fix" lives inside "prefix"; only word-start stems may fire.
    expect(autoTags('prefix der routen ändern')).not.toContain('bugfix')
  })

  it('handles umlauts at a word start (ASCII \\b does not)', () => {
    expect(autoTags('übersetzung nachziehen')).toContain('i18n')
  })

  it('returns nothing for empty or blank input', () => {
    expect(deriveTags('')).toEqual([])
    expect(deriveTags('   ')).toEqual([])
  })

  it('puts the confident rules before the merely suggestive ones', () => {
    const found = deriveTags('layout und doku')
    expect(found[0]).toMatchObject({ tag: 'documentation', confidence: 'high' })
    expect(found.some((d) => d.tag === 'layout' && d.confidence === 'hint')).toBe(true)
  })
})

describe('autoTags — what may be written without being asked', () => {
  it('writes improvement for "Verbesserung" and bugfix for "behebe Fehler"', () => {
    expect(autoTags('Verbesserung der Suche')).toContain('improvement')
    expect(autoTags('behebe Fehler beim Speichern')).toContain('bugfix')
    expect(autoTags('Login funktioniert nicht')).toContain('bugfix')
    expect(autoTags('repariere den Export')).toContain('bugfix')
  })

  it('names up to three kinds of change in one title', () => {
    // In the order the words appear.
    expect(autoTags('Verbesserung, behebe Fehler am Dialog')).toEqual([
      'improvement',
      'bugfix',
      'gui',
    ])
  })

  it('reads the body as a second source after the title', () => {
    expect(autoTags('Suche', 'Bitte behebe den Fehler beim Filtern.')).toEqual(['bugfix'])
    // Title first, then what the body adds — no duplicates.
    expect(autoTags('doku', 'die doku ist kaputt')).toEqual(['documentation', 'bugfix'])
  })

  it('ignores title-only rules in running body text', () => {
    // "teste das danach" and "füge ... hinzu" describe steps of any change.
    expect(autoTags('Suche', 'teste das danach und füge einen Button hinzu')).toEqual([])
    expect(autoTags('Tests für die Suche')).toContain('testing')
  })

  it('does not take "guide" for gui', () => {
    expect(autoTags('guide für das setup')).not.toContain('gui')
    expect(autoTags('gui aufräumen')).toContain('gui')
  })

  it('still writes nothing for a menu-only rule', () => {
    expect(autoTags('layout spalte')).toEqual([])
    expect(deriveTags('layout spalte').map((d) => d.tag)).toContain('layout')
  })

  it('stops at the limit', () => {
    expect(AUTO_TAG_LIMIT).toBe(3)
    const many = autoTags('doku fehler animation mobil test sicherheit')
    expect(many).toHaveLength(AUTO_TAG_LIMIT)
  })

  it('is deterministic — the same input always yields the same tags', () => {
    expect(autoTags('mobile animation fixen', 'x')).toEqual(autoTags('mobile animation fixen', 'x'))
  })
})

describe('rule table', () => {
  it('only names tags from the curated catalogue', () => {
    const unknown = ruleTargets().filter((t) => !CURATED.has(t))
    expect(unknown).toEqual([])
  })

  it('names no tag twice', () => {
    const targets = ruleTargets()
    expect(new Set(targets).size).toBe(targets.length)
  })
})
