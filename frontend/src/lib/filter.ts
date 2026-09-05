// Which prompts a view shows.
//
// Extracted from App so the rules are testable and so the difference between
// the views is stated once: the board and the list follow the toolbar, the
// bookmarks section deliberately does not. Its controls (search field, project
// chips) are only rendered above the board and the list, so applying them on
// the bookmarks tab would filter the list by settings the user cannot see
// there — a bookmark would silently go missing because of a project chip
// clicked on another tab.
import { parseQuery, promptMatches } from './search-query'
import type { Project, Prompt } from './types'

export interface PromptFilter {
  /** Hidden immediately while their undo window runs. Always applied. */
  pendingDelete?: number[]
  /** `all` (or omitted) keeps every project. */
  project?: number | 'all' | 'none'
  /** Free-text over title, body, tags — und den Namen des Projekts.
   *  `"..."` sucht ausschließlich in Projektnamen (siehe `search-query.ts`). */
  query?: string
  /** Die Projekte, damit die Suche auch deren Namen treffen kann. Fehlt sie,
   *  wird wie bisher nur im Prompt selbst gesucht. */
  projects?: Project[]
}

export function filterPrompts(prompts: Prompt[], filter: PromptFilter = {}): Prompt[] {
  const { pendingDelete, project = 'all', query = '', projects } = filter
  const parsed = parseQuery(query)
  const namen = new Map((projects ?? []).map((p) => [p.id, p.name]))
  const pending = pendingDelete?.length ? new Set(pendingDelete) : null
  return prompts.filter((p) => {
    if (pending?.has(p.id)) return false
    if (project === 'none' && p.project_id != null) return false
    if (typeof project === 'number' && p.project_id !== project) return false
    const projektName = p.project_id != null ? (namen.get(p.project_id) ?? '') : ''
    if (!promptMatches(p, projektName, parsed)) return false
    return true
  })
}

/**
 * The bookmarks section: every bookmark the tenant has, in `bookmark_order`.
 *
 * Global on purpose — bookmarks are the "keep this at hand" shelf, and a shelf
 * that hides half its contents because a project chip is active elsewhere is
 * worse than useless. Only pending deletions are honoured.
 */
export function bookmarkedPrompts(prompts: Prompt[], pendingDelete?: number[]): Prompt[] {
  return filterPrompts(prompts, { pendingDelete }).filter((p) => p.bookmarked)
}
