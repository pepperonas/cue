/**
 * Derive tags from what a prompt is called.
 *
 * The rules below are not invented: they were measured against the live corpus
 * (291 prompts, 231 of them tagged) by asking, for each candidate keyword, how
 * the tags of the matching prompts differ from the base rate. `lift` in the
 * comments is share ÷ base rate — ×1.0 means the keyword says nothing at all.
 *
 * That measurement is the whole reason for the two tiers:
 *
 *   "doku"                -> documentation   86 %  ×28.3
 *   "animier|animation"   -> animation       82 %  ×8.2
 *   "fix|fehler|bug"      -> bugfix          75 %  ×4.8
 *   "mobil|s24|iphone"    -> mobile          33 %  ×38.5
 *   "optimier"            -> optimization    54 %  ×1.8   <- barely above chance
 *   "button|icon|menü"    -> gui              —    no lift at all
 *
 * So `high` rules are applied automatically, `hint` rules only float the tag to
 * the top of the suggestion menu. (0.76.0 promoted improvement, optimization,
 * feature and gui to `high` on explicit request — the author names the kind of
 * change in the title and wants it written; `titleOnly` keeps the noisy ones
 * out of running body text.) Auto-applying "optimization" because someone
 * wrote "optimieren" would be a coin flip, and a wrong tag written without
 * asking is worse than no tag: 21 % of prompts are untagged today, which is the
 * gap this closes — not by guessing louder, but by being right when it speaks.
 *
 * Rules with no corpus support (performance, accessibility, i18n, refactor) are
 * dictionary equivalences, not statistics: "barrierefrei" simply means
 * accessibility. They are marked as such below.
 */

import { DEV_TAGS } from './tags'

export type RuleConfidence = 'high' | 'hint'

interface TagRule {
  tag: string
  /**
   * Word stems. Matched at a word start by default; a leading `*` allows the
   * stem anywhere inside a word, which German compounds need
   * ("hintergrundanimation" is one word in the corpus); a trailing `!` demands
   * the whole word ("gui!" must not fire on "guide").
   */
  stems: string[]
  confidence: RuleConfidence
  /** Matches only in the title, never in the body — for words a body uses in passing. */
  titleOnly?: boolean
}

const RULES: TagRule[] = [
  // ---- applied automatically ----------------------------------------------
  // Measured: 86 % of titles containing these carry `documentation` (×28.3).
  {
    tag: 'documentation',
    stems: ['doku', 'readme', 'changelog', 'docs', 'dokumentier', 'anleitung', 'claude.md'],
    confidence: 'high',
  },
  // Measured: 82 % (×8.2). The `*` form catches "hintergrundanimation".
  {
    tag: 'animation',
    stems: ['*animation', 'animier', 'animate', 'transition', 'übergang'],
    confidence: 'high',
  },
  // Measured: 75 % (×4.8). Extended (0.76.0) with the verbs people actually
  // write: "behebe", "repariere", "funktioniert nicht", "geht nicht".
  {
    tag: 'bugfix',
    stems: [
      'fix',
      'fehler',
      'bug',
      'kaputt',
      'absturz',
      'abstürz',
      'crash',
      'behe',
      'defekt',
      'broken',
      'repar',
      'funktioniert nicht',
      'geht nicht',
      'klappt nicht',
      'error',
      'exception',
      'falsch angezeigt',
    ],
    confidence: 'high',
  },
  // Measured ×38.5 — the share is low only because those prompts carry other tags too.
  {
    tag: 'mobile',
    stems: ['mobil', 'handy', 'smartphone', 's24', 'iphone', 'android', 'touch'],
    confidence: 'high',
  },
  { tag: 'responsive', stems: ['responsive'], confidence: 'high' },
  // "teste das danach" sits in half the prompt BODIES — only the title counts.
  { tag: 'testing', stems: ['test', 'unit-test', 'unittest'], confidence: 'high', titleOnly: true },
  {
    tag: 'security',
    stems: ['security', 'sicherheit', 'passwort', 'verschlüssel', 'xss', 'csrf', 'sicherheitslücke'],
    confidence: 'high',
  },
  // ---- dictionary-equivalent: the word simply means the tag ----------------
  {
    tag: 'performance',
    stems: ['performance', 'langsam', 'ladezeit', 'schneller', 'ruckel', 'laggt', 'performant'],
    confidence: 'high',
  },
  {
    tag: 'accessibility',
    stems: ['barrierefrei', 'accessibility', 'a11y', 'screenreader', 'kontrast'],
    confidence: 'high',
  },
  {
    tag: 'i18n',
    stems: ['übersetzung', 'übersetzen', 'lokalisierung', 'i18n', 'mehrsprachig'],
    confidence: 'high',
  },
  {
    tag: 'refactor',
    stems: [
      'refactor',
      'refaktor',
      'aufräum',
      'umbau',
      'cleanup',
      'entrümpel',
      'umstrukturier',
      'vereinfach',
    ],
    confidence: 'high',
  },
  // Promoted to `high` in 0.76.0 on request: "Verbesserung" in a title is the
  // author saying what kind of change this is — writing it is what they asked
  // for, and one Backspace undoes it.
  {
    tag: 'improvement',
    stems: [
      'verbesser',
      'besser',
      'schöner',
      'benutzerfreundlich',
      'komfort',
      'überarbeit',
      'aufhübsch',
      'polish',
      'improve',
      'eleganter',
      'intuitiver',
    ],
    confidence: 'high',
  },
  {
    tag: 'optimization',
    stems: ['optimier', 'optimize', 'optimierung'],
    confidence: 'high',
  },
  {
    tag: 'feature',
    stems: [
      'feature',
      'hinzufüg',
      'füge',
      'einbau',
      'baue',
      'implementier',
      'einführ',
      'ergänz',
      'neue funktion',
      'neues feature',
      'unterstütz',
    ],
    confidence: 'high',
    // A body says "ergänze die Doku" or "füge einen Test hinzu" about steps of
    // any change — only a title states that the change IS a feature.
    titleOnly: true,
  },
  {
    tag: 'gui',
    stems: ['gui!', 'ui!', 'oberfläche', 'knopf', 'button', 'dialog', 'design', 'darstellung', 'ansicht'],
    confidence: 'high',
    titleOnly: true,
  },

  // ---- menu ordering only --------------------------------------------------
  { tag: 'enhancement', stems: ['erweiter', 'ausbau', 'zusätzlich'], confidence: 'hint' },
  { tag: 'layout', stems: ['layout', 'spalte', 'grid', 'abstand', 'padding'], confidence: 'hint' },
  { tag: 'theme', stems: ['theme', 'dark-mode', 'dunkel', 'hell-modus'], confidence: 'hint' },
  { tag: 'typography', stems: ['schrift', 'typograf', 'font'], confidence: 'hint' },
  { tag: 'database', stems: ['datenbank', 'migration', 'sqlite', 'postgres'], confidence: 'hint' },
  { tag: 'api', stems: ['endpoint', 'route', 'api'], confidence: 'hint' },
  { tag: 'deploy', stems: ['deploy', 'rollout', 'ausrollen', 'release'], confidence: 'hint' },
  { tag: 'auth', stems: ['login', 'anmeldung', 'oauth', 'session'], confidence: 'hint' },
]

/** Letters that count as part of a word here — ASCII \b mishandles umlauts. */
const WORDISH = 'a-z0-9äöüß'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stemPattern(stem: string): RegExp {
  if (stem.startsWith('*')) return new RegExp(escapeRe(stem.slice(1)))
  // A trailing `!` demands the whole word: "gui" must not fire on "guide".
  const whole = stem.endsWith('!')
  const core = escapeRe(whole ? stem.slice(0, -1) : stem)
  return new RegExp(`(?:^|[^${WORDISH}])${core}${whole ? `(?![${WORDISH}])` : ''}`)
}

// Compiled once: the table is static.
const COMPILED = RULES.map((rule) => ({
  ...rule,
  patterns: rule.stems.map(stemPattern),
}))

export interface DerivedTag {
  tag: string
  confidence: RuleConfidence
  /** Where the first matching stem was found — used to order equal tiers. */
  at: number
}

/**
 * All tags whose rules match `text`, high confidence first and otherwise in the
 * order the words appear, so the ordering follows the sentence the user wrote.
 */
export function deriveTags(text: string, opts: { body?: boolean } = {}): DerivedTag[] {
  const haystack = (text ?? '').toLowerCase()
  if (!haystack.trim()) return []
  const found: DerivedTag[] = []
  for (const rule of COMPILED) {
    if (opts.body && rule.titleOnly) continue
    let at = -1
    for (const pattern of rule.patterns) {
      const m = pattern.exec(haystack)
      if (m && (at < 0 || m.index < at)) at = m.index
    }
    if (at >= 0) found.push({ tag: rule.tag, confidence: rule.confidence, at })
  }
  found.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1
    if (a.at !== b.at) return a.at - b.at
    return a.tag.localeCompare(b.tag)
  })
  return found
}

/**
 * How many tags may be written without being asked for.
 *
 * Measured in 0.45.0: of 231 tagged prompts, 208 carried one or two. Raised to
 * three in 0.76.0 together with the body as a second source — "Verbesserung,
 * behebe Fehler am Dialog" honestly names three things.
 */
export const AUTO_TAG_LIMIT = 3

/**
 * The tags confident enough to fill in on their own.
 *
 * The title speaks first; the body only adds what the title did not already
 * say, and only through rules that are safe in running text (`titleOnly`
 * rules are skipped there). Order: title matches, then body matches, each in
 * the order the words appear.
 */
export function autoTags(title: string, body = '', limit = AUTO_TAG_LIMIT): string[] {
  const out: string[] = []
  const take = (found: DerivedTag[]) => {
    for (const d of found) {
      if (d.confidence === 'high' && !out.includes(d.tag)) out.push(d.tag)
    }
  }
  take(deriveTags(title))
  take(deriveTags(body, { body: true }))
  return out.slice(0, limit)
}

/** Every rule target, for the invariant test — each must be a curated tag. */
export function ruleTargets(): string[] {
  return RULES.map((r) => r.tag)
}

/** Exposed so the test can prove the rule table only names known tags. */
export const CURATED = new Set(DEV_TAGS)
