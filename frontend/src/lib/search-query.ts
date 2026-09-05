/**
 * Was der Text im Suchfeld bedeutet.
 *
 * Zwei Formen, eine Regel:
 *
 *   · `termst`     — sucht im Prompt **und** im Namen seines Projekts
 *   · `"termst"`   — sucht **nur** im Projektnamen
 *
 * Die Anführungszeichen sind kein Zufallsfund: ohne sie findet „doku" auch
 * jeden Prompt, in dem das Wort vorkommt, und ein Projekt, das so heißt, geht
 * darin unter. Mit ihnen fragt man ausdrücklich nach dem Projekt.
 *
 * ⚠️ Diese Datei ist die EINZIGE Stelle, die die Eingabe auslegt. Board, Liste
 * und die Projekt-Chips leiten alles daraus ab — zwei Auslegungen wären zwei
 * Antworten auf dieselbe Frage, und die Chips zeigten Projekte, deren Klick
 * ein leeres Board ergibt.
 */
import type { Project, Prompt } from './types'

export interface ParsedQuery {
  /** Der gesuchte Text, klein geschrieben, ohne Anführungszeichen. */
  needle: string
  /** Nur Projektnamen durchsuchen. */
  projectsOnly: boolean
}

/**
 * Die Eingabe auslegen.
 *
 * ⚠️ Das ÖFFNENDE Anführungszeichen entscheidet, das schließende ist optional.
 * Zuerst war ein vollständiges Paar verlangt — im Browser nachgespielt heißt
 * das: solange man tippt (`"`, `"c`, `"cu`, `"cue`), sucht die App wörtlich
 * nach `"cue` und findet nichts, und erst das letzte Zeichen lässt das
 * Ergebnis auf einen Schlag erscheinen. Genau der Sprung, den die Regel
 * verhindern sollte. Mit dem öffnenden Zeichen als Auslöser wird die Liste
 * beim Tippen enger, wie man es von einem Suchfeld erwartet.
 */
export function parseQuery(raw: string): ParsedQuery {
  const text = (raw ?? '').trim()
  const quoted = text.startsWith('"') || text.startsWith('„')
  const inner = quoted ? text.replace(/^["„]/, '').replace(/["“]$/, '').trim() : text
  // Ein einzelnes Anführungszeichen fragt nach nichts: leerer Suchbegriff,
  // also bleibt alles stehen, bis das erste Zeichen kommt.
  return { needle: inner.toLowerCase(), projectsOnly: quoted && inner.length > 0 }
}

/** Passt ein Prompt zur Suche? `projectName` ist leer, wenn es keins hat. */
export function promptMatches(p: Prompt, projectName: string, parsed: ParsedQuery): boolean {
  if (!parsed.needle) return true
  const name = projectName.toLowerCase()
  if (parsed.projectsOnly) return name.includes(parsed.needle)
  // Der Projektname gehört zum Heuhaufen: sonst zeigte ein Chip, der nur über
  // seinen Namen gefunden wurde, beim Klick ein leeres Board.
  return (
    `${p.title} ${p.body} ${p.tags}`.toLowerCase().includes(parsed.needle) ||
    name.includes(parsed.needle)
  )
}

/**
 * Welche Projekte oben als Chip erscheinen.
 *
 * Ohne Suche: alle. Mit Suche: die, deren **Name** passt — und zusätzlich, wenn
 * nicht ausdrücklich nach Projekten gesucht wird, die mit mindestens einem
 * gefundenen Prompt.
 *
 * ⚠️ Ein Projekt, dessen Name passt, bleibt auch dann sichtbar, wenn es leer
 * ist: es ist ja genau das, wonach gefragt wurde.
 */
export function visibleProjects(
  projects: Project[],
  prompts: Prompt[],
  parsed: ParsedQuery,
): Project[] {
  if (!parsed.needle) return projects
  const namen = new Map(projects.map((p) => [p.id, p.name]))
  const mitTreffer = new Set<number>()
  // ⚠️ Hier steht bewusst KEINE eigene Abfrage auf `projectsOnly`.
  // `promptMatches` kennt die Regel bereits: bei einer Projektsuche zählt nur
  // der Name, ein Prompt fügt also nichts hinzu, was der Namensvergleich unten
  // nicht ohnehin fände. Eine zweite Wache wäre keine Regel, sondern eine
  // Wiederholung — die Mutationsprobe hat sie als wirkungslos entlarvt.
  for (const p of prompts) {
    if (p.project_id != null && promptMatches(p, namen.get(p.project_id) ?? '', parsed)) {
      mitTreffer.add(p.project_id)
    }
  }
  return projects.filter(
    (p) => p.name.toLowerCase().includes(parsed.needle) || mitTreffer.has(p.id),
  )
}

/**
 * Ist „Ohne Projekt" noch sinnvoll?
 *
 * Bei einer Projektsuche nie — was keins hat, hat auch keinen Namen, der
 * passen könnte. Sonst nur, wenn wirklich ein gefundener Prompt ohne Projekt
 * dabei ist; ein Chip, der auf nichts zeigt, ist ein Klick ins Leere.
 */
export function showsUnassigned(prompts: Prompt[], parsed: ParsedQuery): boolean {
  if (!parsed.needle) return true
  // Auch hier reicht `promptMatches`: ohne Projekt ist der Name leer, und bei
  // einer Projektsuche kann ein leerer Name nichts treffen.
  return prompts.some((p) => p.project_id == null && promptMatches(p, '', parsed))
}
