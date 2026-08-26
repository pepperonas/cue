import { describe, expect, it } from 'vitest'
import {
  acceptCompletion,
  buildTitleModel,
  completeTitle,
  MIN_PREFIX,
  MIN_SUPPORT,
  titleWords,
} from './title-complete'

/** A corpus shaped like the real one: short, repetitive, German, lower case. */
const CORPUS = [
  'doku updaten',
  'doku updaten',
  'doku schreiben',
  'theme wechsel fixen',
  'theme wechsel optimieren',
  'board projekt sortierung optimieren',
  'animation verbessern',
]

const model = buildTitleModel(CORPUS)

describe('titleWords', () => {
  it('splits on any run of whitespace and drops the empties', () => {
    expect(titleWords('  doku   updaten ')).toEqual(['doku', 'updaten'])
    expect(titleWords('')).toEqual([])
  })
})

describe('completeTitle — while a word is being typed', () => {
  it('completes the word from the corpus', () => {
    expect(completeTitle(model, 'dok')).toEqual({ insert: 'u', word: 'doku', kind: 'prefix' })
  })

  it('inserts only the tail, so the typed casing survives untouched', () => {
    // "Dok" + "u" — never rewritten to the corpus spelling "doku".
    expect(completeTitle(model, 'Dok')?.insert).toBe('u')
  })

  it('stays quiet below the measured prefix threshold', () => {
    expect(MIN_PREFIX).toBe(2)
    expect(completeTitle(model, 'd')).toBeNull()
  })

  it('says nothing on an empty field (measured: 2 % correct there)', () => {
    expect(completeTitle(model, '')).toBeNull()
  })

  it('offers nothing for a prefix the corpus has never seen', () => {
    expect(completeTitle(model, 'xyz')).toBeNull()
  })

  it('does not re-offer a word that is already complete', () => {
    // "theme" is in the corpus but nothing extends it — no ghost of itself.
    expect(completeTitle(model, 'theme')).toBeNull()
  })

  it('lets the context decide between candidates sharing a prefix', () => {
    const ctx = buildTitleModel([
      'theme optimieren',
      'theme optimieren',
      'board options',
      'board options',
      'board options',
    ])
    // Without a context, "op" goes to the globally more frequent word…
    expect(completeTitle(ctx, 'op')?.word).toBe('options')
    // …after "board" too…
    expect(completeTitle(ctx, 'board op')?.word).toBe('options')
    // …but after "theme" the corpus only ever went to "optimieren".
    expect(completeTitle(ctx, 'theme op')?.word).toBe('optimieren')
  })
})

describe('completeTitle — proposing the next word', () => {
  it('predicts the word that followed most often', () => {
    expect(completeTitle(model, 'doku ')).toEqual({
      insert: 'updaten',
      word: 'updaten',
      kind: 'next',
    })
  })

  it('requires the context to have been seen more than once', () => {
    expect(MIN_SUPPORT).toBe(2)
    // "animation" was followed by "verbessern" exactly once — noise, not a habit.
    expect(completeTitle(model, 'animation ')).toBeNull()
  })

  it('prefers the two-word context over the single-word one', () => {
    const ctx = buildTitleModel([
      'theme wechsel fixen',
      'theme wechsel fixen',
      'board wechsel optimieren',
      'board wechsel optimieren',
      'board wechsel optimieren',
    ])
    expect(completeTitle(ctx, 'theme wechsel ')?.word).toBe('fixen')
    expect(completeTitle(ctx, 'board wechsel ')?.word).toBe('optimieren')
  })
})

describe('acceptCompletion', () => {
  it('appends the insertion plus a space, so the next word is proposed at once', () => {
    const first = completeTitle(model, 'dok')!
    const afterFirst = acceptCompletion('dok', first)
    expect(afterFirst).toBe('doku ')

    // …and that is what chains Enter into "word for word".
    const second = completeTitle(model, afterFirst)!
    expect(second.kind).toBe('next')
    expect(acceptCompletion(afterFirst, second)).toBe('doku updaten ')
  })
})

describe('buildTitleModel', () => {
  it('survives an empty corpus and blank titles', () => {
    const empty = buildTitleModel(['', '   '])
    expect(completeTitle(empty, 'dok')).toBeNull()
  })

  it('remembers the most frequent spelling of a word', () => {
    const cased = buildTitleModel(['LoC workflow', 'LoC neuer command', 'loc anderes'])
    expect(completeTitle(cased, 'Lo')?.word).toBe('LoC')
  })
})
