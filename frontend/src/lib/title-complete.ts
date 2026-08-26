/**
 * Word-by-word title completion, fed by the titles the user has written before.
 *
 * Why an n-gram model over the user's OWN titles and nothing else: measured on
 * the live corpus (291 titles), the vocabulary is small and extremely
 * repetitive — 94 titles are exactly two words, the verb "optimieren" appears
 * 20 times, "animation" 11, "fixen" 8. A generic word list would predict none
 * of that.
 *
 * The thresholds below are not taste, they are measured (leave-one-out over the
 * same corpus):
 *
 *   next word from context alone, no prefix typed ...... 20 % correct
 *     …of which, on an EMPTY field ......................  2 % correct
 *   completing the word being typed, 1 char typed ...... 25 %
 *                                    2 chars typed ..... 36 %
 *                                    3 chars typed ..... 51 %
 *
 * Hence: never suggest into an empty field, require MIN_PREFIX characters
 * before completing a word, and require a context to have been seen
 * MIN_SUPPORT times before predicting a whole word out of thin air (that cut
 * two thirds of the offers while precision held — the discarded ones came from
 * contexts seen exactly once, i.e. noise).
 *
 * A wrong ghost costs nothing: it is inert grey text that vanishes on the next
 * keystroke. That asymmetry is what makes a 36 %-correct suggestion worth
 * showing at all.
 */

/** Characters of the current word required before it is completed. */
export const MIN_PREFIX = 2
/** How often a context must have been seen before a whole word is predicted. */
export const MIN_SUPPORT = 2

export interface TitleModel {
  /** Lower-cased word -> its most frequent original spelling. */
  spelling: Map<string, string>
  /** Counts of the first word of a title. */
  starts: Map<string, number>
  /** previous word -> counts of what followed. */
  after1: Map<string, Map<string, number>>
  /** "prev2 prev1" -> counts of what followed. */
  after2: Map<string, Map<string, number>>
  /** Every word -> count. Last-resort source for prefix completion. */
  vocab: Map<string, number>
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function bumpNested(map: Map<string, Map<string, number>>, key: string, value: string) {
  let inner = map.get(key)
  if (!inner) {
    inner = new Map()
    map.set(key, inner)
  }
  bump(inner, value)
}

/** Split a title the way the input does — on whitespace, keeping nothing empty. */
export function titleWords(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

/**
 * Build the completion model. Words are keyed lower-cased so "Doku" and "doku"
 * are one entry; the most frequent original spelling is remembered and used for
 * the inserted text.
 */
export function buildTitleModel(titles: readonly string[]): TitleModel {
  const model: TitleModel = {
    spelling: new Map(),
    starts: new Map(),
    after1: new Map(),
    after2: new Map(),
    vocab: new Map(),
  }
  const spellings = new Map<string, Map<string, number>>()
  for (const title of titles) {
    const raw = titleWords(title ?? '')
    if (!raw.length) continue
    const words = raw.map((w) => w.toLowerCase())
    bump(model.starts, words[0])
    words.forEach((word, i) => {
      bump(model.vocab, word)
      bumpNested(spellings, word, raw[i])
      if (i >= 1) bumpNested(model.after1, words[i - 1], word)
      if (i >= 2) bumpNested(model.after2, `${words[i - 2]} ${words[i - 1]}`, word)
    })
  }
  for (const [word, variants] of spellings) {
    model.spelling.set(word, pickBest(variants) ?? word)
  }
  return model
}

/** The most frequent entry; ties break alphabetically so the result is stable. */
function pickBest(counts: Map<string, number>, accept?: (word: string) => boolean): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [word, count] of counts) {
    if (accept && !accept(word)) continue
    if (count > bestCount || (count === bestCount && best !== null && word < best)) {
      best = word
      bestCount = count
    }
  }
  return best
}

function bestCount(counts: Map<string, number>, word: string): number {
  return counts.get(word) ?? 0
}

export interface Completion {
  /** Exactly the characters to append to the current value. */
  insert: string
  /** The full word being proposed (for the accessible announcement). */
  word: string
  /** 'prefix' finishes the word being typed, 'next' proposes a new one. */
  kind: 'prefix' | 'next'
}

/**
 * Propose the next word for `value`.
 *
 * Two modes, and the mental model is deliberately that simple:
 *   typing letters   -> completes THIS word (needs MIN_PREFIX characters)
 *   after a space    -> proposes the NEXT word (needs MIN_SUPPORT sightings)
 *
 * Accepting appends a trailing space, so the second mode fires immediately and
 * Enter chains word by word.
 */
export function completeTitle(model: TitleModel, value: string): Completion | null {
  const words = titleWords(value).map((w) => w.toLowerCase())
  const typingWord = !/\s$/.test(value)
  const context = typingWord ? words.slice(0, -1) : words
  const sources = contextSources(model, context)

  if (!typingWord) {
    // Whole-word prediction: only from a context we have actually seen repeat.
    for (const source of sources) {
      const word = pickBest(source)
      if (word && bestCount(source, word) >= MIN_SUPPORT) {
        return { insert: spell(model, word), word: spell(model, word), kind: 'next' }
      }
    }
    return null
  }

  const typed = words[words.length - 1] ?? ''
  // Also what keeps an EMPTY field silent: there is nothing typed to complete,
  // and a guess into an empty field was measured at 2 % correct.
  if (typed.length < MIN_PREFIX) return null
  const starts = (word: string) => word.startsWith(typed) && word !== typed
  for (const source of [...sources, model.vocab]) {
    const word = pickBest(source, starts)
    if (word) {
      // Only the TAIL is inserted, so the user's own casing of what they typed
      // survives untouched — the ghost shows exactly what will be added.
      const full = spell(model, word)
      return { insert: full.slice(typed.length), word: full, kind: 'prefix' }
    }
  }
  return null
}

function spell(model: TitleModel, word: string): string {
  return model.spelling.get(word) ?? word
}

/** Candidate pools for a context, most specific first. */
function contextSources(model: TitleModel, context: string[]): Map<string, number>[] {
  const out: Map<string, number>[] = []
  if (context.length >= 2) {
    const two = model.after2.get(`${context[context.length - 2]} ${context[context.length - 1]}`)
    if (two) out.push(two)
  }
  if (context.length >= 1) {
    const one = model.after1.get(context[context.length - 1])
    if (one) out.push(one)
  }
  if (context.length === 0 && model.starts.size) out.push(model.starts)
  return out
}

/**
 * Apply a completion. The trailing space is what makes the next Enter propose
 * the following word instead of re-completing the one just accepted.
 */
export function acceptCompletion(value: string, completion: Completion): string {
  return `${value}${completion.insert} `
}
