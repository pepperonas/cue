import { describe, expect, it } from 'vitest'
import { parseQuery, promptMatches, showsUnassigned, visibleProjects } from './search-query'
import type { Project, Prompt } from './types'

const projekt = (id: number, name: string): Project =>
  ({ id, name, color: '#000', sort_order: id, created_at: '', prompt_count: 0 }) as Project

const prompt = (id: number, over: Partial<Prompt>): Prompt =>
  ({
    id,
    title: '',
    body: '',
    tags: '',
    project_id: null,
    status: 'queued',
    ...over,
  }) as Prompt

const PROJEKTE = [projekt(1, 'termstats'), projekt(2, 'cue'), projekt(3, 'website')]
const PROMPTS = [
  prompt(10, { title: 'Charts glätten', body: 'plotext', project_id: 1 }),
  prompt(11, { title: 'Doku schreiben', body: 'termst kommt hier im Text vor', project_id: 2 }),
  prompt(12, { title: 'Footer', body: 'nichts davon', project_id: 3 }),
  prompt(13, { title: 'Ohne Heimat', body: 'termst steht auch hier', project_id: null }),
]

describe('parseQuery', () => {
  it('reads plain text as a search over everything', () => {
    expect(parseQuery('termst')).toEqual({ needle: 'termst', projectsOnly: false })
  })

  it('reads a quoted term as a project-name search', () => {
    expect(parseQuery('"termst"')).toEqual({ needle: 'termst', projectsOnly: true })
  })

  it('accepts German quotation marks too', () => {
    // Wer auf einer deutschen Tastatur schreibt, tippt gern „…“.
    expect(parseQuery('„termst“')).toEqual({ needle: 'termst', projectsOnly: true })
  })

  it('lower-cases the needle so the search is case-insensitive', () => {
    expect(parseQuery('TermSt').needle).toBe('termst')
    expect(parseQuery('"TermSt"').needle).toBe('termst')
  })

  it('ignores surrounding whitespace, inside the quotes too', () => {
    expect(parseQuery('  termst ')).toEqual({ needle: 'termst', projectsOnly: false })
    expect(parseQuery('" termst "')).toEqual({ needle: 'termst', projectsOnly: true })
  })

  it('starts the project search at the OPENING quote already', () => {
    // ⚠️ Das schließende Zeichen ist optional. Verlangte man das Paar, suchte
    // die App während des Tippens wörtlich nach `"term`, fände nichts — und
    // das Ergebnis erschiene erst beim letzten Zeichen auf einen Schlag.
    // Im Browser nachgespielt und deshalb geändert.
    expect(parseQuery('"term')).toEqual({ needle: 'term', projectsOnly: true })
  })

  it('narrows monotonically while the term is typed', () => {
    const schritte = ['"', '"c', '"cu', '"cue'].map(parseQuery)
    expect(schritte.map((s) => s.needle)).toEqual(['', 'c', 'cu', 'cue'])
    // Das erste Zeichen sucht noch nichts — sonst verschwände beim Tippen des
    // Anführungszeichens kurz die halbe Oberfläche.
    expect(schritte[0].projectsOnly).toBe(false)
    expect(schritte.slice(1).every((s) => s.projectsOnly)).toBe(true)
  })

  it('needs the quote at the START, not just anywhere', () => {
    // Ein Zeichen am Ende macht aus einer Textsuche keine Projektsuche.
    expect(parseQuery('term"')).toEqual({ needle: 'term"', projectsOnly: false })
  })

  it('treats a lone quote character as no search at all', () => {
    expect(parseQuery('"')).toEqual({ needle: '', projectsOnly: false })
  })

  it('treats empty quotes as no search at all', () => {
    // `""` fragt nach nichts — es soll nicht plötzlich alle Projekte ausblenden.
    expect(parseQuery('""')).toEqual({ needle: '', projectsOnly: false })
  })

  it('is empty for an empty field', () => {
    expect(parseQuery('')).toEqual({ needle: '', projectsOnly: false })
    expect(parseQuery('   ')).toEqual({ needle: '', projectsOnly: false })
  })
})

describe('promptMatches', () => {
  it('keeps everything when nothing is searched', () => {
    expect(promptMatches(PROMPTS[2], 'website', parseQuery(''))).toBe(true)
  })

  it('finds the needle in title, body and tags', () => {
    const q = parseQuery('glätten')
    expect(promptMatches(PROMPTS[0], 'termstats', q)).toBe(true)
    expect(promptMatches(PROMPTS[2], 'website', parseQuery('#feature'))).toBe(false)
  })

  it('also finds it in the name of the prompt’s project', () => {
    // ⚠️ Das ist der Grund, warum ein über den Namen gefundener Chip beim
    // Klick nicht ins Leere führt: der Prompt zählt dann als Treffer.
    const q = parseQuery('termst')
    expect(promptMatches(PROMPTS[0], 'termstats', q)).toBe(true)
  })

  it('looks ONLY at the project name when quoted', () => {
    const q = parseQuery('"termst"')
    // Steht im Text, aber das Projekt heißt anders → kein Treffer.
    expect(promptMatches(PROMPTS[1], 'cue', q)).toBe(false)
    // Steht nicht im Text, aber das Projekt heißt so → Treffer.
    expect(promptMatches(PROMPTS[0], 'termstats', q)).toBe(true)
  })

  it('treats a prompt without a project as having an empty name', () => {
    expect(promptMatches(PROMPTS[3], '', parseQuery('"termst"'))).toBe(false)
    expect(promptMatches(PROMPTS[3], '', parseQuery('termst'))).toBe(true)
  })
})

describe('visibleProjects', () => {
  it('shows every project when nothing is searched', () => {
    expect(visibleProjects(PROJEKTE, PROMPTS, parseQuery(''))).toEqual(PROJEKTE)
  })

  it('shows a project whose NAME matches', () => {
    const out = visibleProjects(PROJEKTE, PROMPTS, parseQuery('termst'))
    expect(out.map((p) => p.name)).toContain('termstats')
  })

  it('shows a project whose PROMPTS match', () => {
    // „cue" hat einen Prompt, in dessen Text „termst" steht.
    const out = visibleProjects(PROJEKTE, PROMPTS, parseQuery('termst'))
    expect(out.map((p) => p.name)).toEqual(['termstats', 'cue'])
  })

  it('drops a project that matches in neither way', () => {
    const out = visibleProjects(PROJEKTE, PROMPTS, parseQuery('termst'))
    expect(out.map((p) => p.name)).not.toContain('website')
  })

  it('shows ONLY name matches when quoted', () => {
    // ⚠️ Der unterscheidende Fall: „cue" hat einen passenden Prompt, aber der
    // Name passt nicht — in Anführungszeichen fällt es weg.
    const out = visibleProjects(PROJEKTE, PROMPTS, parseQuery('"termst"'))
    expect(out.map((p) => p.name)).toEqual(['termstats'])
  })

  it('keeps an EMPTY project whose name matches', () => {
    // Genau danach wurde gefragt — dass es noch keine Prompts hat, ändert das
    // nicht.
    const leer = [...PROJEKTE, projekt(4, 'termst-neu')]
    const out = visibleProjects(leer, PROMPTS, parseQuery('"termst"'))
    expect(out.map((p) => p.name)).toEqual(['termstats', 'termst-neu'])
  })

  it('finds nothing for a term nobody carries', () => {
    expect(visibleProjects(PROJEKTE, PROMPTS, parseQuery('xyzzy'))).toEqual([])
  })

  it('keeps the given order', () => {
    // Die Reihenfolge entsteht später (nach offenen Prompts sortiert); hier
    // darf sie nicht heimlich umgestellt werden.
    const out = visibleProjects(PROJEKTE, PROMPTS, parseQuery('e'))
    expect(out.map((p) => p.id)).toEqual([1, 2, 3])
  })
})

describe('showsUnassigned', () => {
  it('is shown without a search', () => {
    expect(showsUnassigned(PROMPTS, parseQuery(''))).toBe(true)
  })

  it('is shown when a matching prompt has no project', () => {
    expect(showsUnassigned(PROMPTS, parseQuery('termst'))).toBe(true)
  })

  it('is hidden when nothing without a project matches', () => {
    expect(showsUnassigned(PROMPTS, parseQuery('glätten'))).toBe(false)
  })

  it('is NEVER shown for a project search', () => {
    // Was kein Projekt hat, hat auch keinen Namen, der passen könnte.
    expect(showsUnassigned(PROMPTS, parseQuery('"termst"'))).toBe(false)
  })
})
