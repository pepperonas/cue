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
 * the top of the suggestion menu. Auto-applying "optimization" because someone
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
   * ("hintergrundanimation" is one word in the corpus).
   */
  stems: string[]
  confidence: RuleConfidence
}

const RULES: TagRule[] = [
  // ---- measured, high lift: applied automatically -------------------------
  // 86 % of titles containing these carry `documentation` (×28.3).
  { tag: 'documentation', stems: ['doku', 'readme', 'changelog', 'docs'], confidence: 'high' },
  // 82 % (×8.2). The `*` form catches "hintergrundanimation".
  {
    tag: 'animation',
    stems: ['*animation', 'animier', 'animate', 'transition', 'übergang'],
    confidence: 'high',
  },
  // 75 % (×4.8).
  {
    tag: 'bugfix',
    stems: ['fix', 'fehler', 'bug', 'kaputt', 'absturz', 'crash', 'behe', 'defekt', 'broken'],
    confidence: 'high',
  },
  // ×38.5 — the share is low only because those prompts carry other tags too.
  {
    tag: 'mobile',
    stems: ['mobil', 'handy', 'smartphone', 's24', 'iphone', 'android', 'touch'],
    confidence: 'high',
  },
  { tag: 'responsive', stems: ['responsive'], confidence: 'high' },
  // ×77 on a thin sample (n=3), but "test" -> testing is not a guess.
  { tag: 'testing', stems: ['test'], confidence: 'high' },
  // ×77, likewise thin.
  {
    tag: 'security',
    stems: ['security', 'sicherheit', 'passwort', 'verschlüssel', 'xss', 'csrf'],
    confidence: 'high',
  },
  // ---- no corpus support, but dictionary-equivalent ------------------------
  {
    tag: 'performance',
    stems: ['performance', 'langsam', 'ladezeit', 'schneller', 'ruckel', 'laggt'],
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
    stems: ['refactor', 'aufräum', 'umbau', 'cleanup', 'entrümpel'],
    confidence: 'high',
  },

  // ---- measured at or near the base rate: menu ordering only --------------
  // ×1.8 — the single most common word in the corpus ("optimieren", 20×), and
  // still only just above chance. Offered, never written.
  {
    tag: 'optimization',
    stems: ['optimier', 'optimize', 'optimierung'],
    confidence: 'hint',
  },
  {
    tag: 'improvement',
    stems: ['verbesser', 'besser', 'schöner', 'benutzerfreundlich', 'komfort'],
    confidence: 'hint',
  },
  {
    tag: 'feature',
    stems: ['hinzufüg', 'einbau', 'erstell', 'implementier', 'einführ', 'ergänz', 'neue'],
    confidence: 'hint',
  },
  { tag: 'enhancement', stems: ['erweiter', 'ausbau', 'zusätzlich'], confidence: 'hint' },
  // The `gui` tag IS used for visual work — but no keyword predicts it, so it
  // is offered and never written.
  {
    tag: 'gui',
    stems: ['button', 'icon', 'label', 'menü', 'ansicht', 'darstellung', 'oberfläche', 'emoji'],
    confidence: 'hint',
  },
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
  return stem.startsWith('*')
    ? new RegExp(escapeRe(stem.slice(1)))
    : new RegExp(`(?:^|[^${WORDISH}])${escapeRe(stem)}`)
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
export function deriveTags(text: string): DerivedTag[] {
  const haystack = (text ?? '').toLowerCase()
  if (!haystack.trim()) return []
  const found: DerivedTag[] = []
  for (const rule of COMPILED) {
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
 * Measured: of 231 tagged prompts, 208 carry one or two tags. Writing more than
 * that would not be help, it would be noise the user has to clean up.
 */
export const AUTO_TAG_LIMIT = 2

/** The tags confident enough to fill in on their own. */
export function autoTags(text: string, limit = AUTO_TAG_LIMIT): string[] {
  return deriveTags(text)
    .filter((d) => d.confidence === 'high')
    .slice(0, limit)
    .map((d) => d.tag)
}

/** Every rule target, for the invariant test — each must be a curated tag. */
export function ruleTargets(): string[] {
  return RULES.map((r) => r.tag)
}

/** Exposed so the test can prove the rule table only names known tags. */
export const CURATED = new Set(DEV_TAGS)
