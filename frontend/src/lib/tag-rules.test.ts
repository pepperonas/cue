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
    const found = deriveTags('optimieren und doku')
    expect(found[0]).toMatchObject({ tag: 'documentation', confidence: 'high' })
    expect(found.some((d) => d.tag === 'optimization' && d.confidence === 'hint')).toBe(true)
  })
})

describe('autoTags — what may be written without being asked', () => {
  it('never writes a merely suggestive tag', () => {
    // "optimieren" is the most common word in the corpus and still only ×1.8
    // above the base rate: offered in the menu, never filled in.
    expect(autoTags('menü optimierung')).toEqual([])
    expect(deriveTags('menü optimierung').map((d) => d.tag)).toContain('optimization')
  })

  it('never writes `gui`, which no keyword actually predicts', () => {
    expect(autoTags('button icon label')).toEqual([])
  })

  it('stops at the measured limit (208 of 231 tagged prompts carry 1–2 tags)', () => {
    expect(AUTO_TAG_LIMIT).toBe(2)
    const many = autoTags('doku fehler animation mobil test sicherheit')
    expect(many).toHaveLength(AUTO_TAG_LIMIT)
  })

  it('is deterministic — the same title always yields the same tags', () => {
    expect(autoTags('mobile animation fixen')).toEqual(autoTags('mobile animation fixen'))
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
