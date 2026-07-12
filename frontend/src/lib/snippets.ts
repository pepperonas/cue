// Pure grouping/sorting helpers for the snippet library (tested in vitest).
import type { Snippet, SnippetGroup } from './types'

export const UNGROUPED_KEY = ''
export const UNGROUPED_LABEL = 'Ohne Gruppe'

export interface SnippetSection {
  key: string // group name, or '' for ungrouped
  name: string // display label
  groupId: number | null
  snippets: Snippet[]
}

/** Group snippets into ordered sections: groups by their sort_order (EMPTY
 * groups included), snippets inside by sort_order/id, "Ohne Gruppe" last.
 * Snippets pointing at an unknown group name get a trailing section so
 * nothing ever disappears from the UI. */
export function groupSnippets(snippets: Snippet[], groups: SnippetGroup[]): SnippetSection[] {
  const byGroup = new Map<string, Snippet[]>()
  for (const s of snippets) {
    const key = s.group_name ?? UNGROUPED_KEY
    const list = byGroup.get(key) ?? []
    list.push(s)
    byGroup.set(key, list)
  }
  const sortSnips = (list: Snippet[]) =>
    [...list].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)

  const sections: SnippetSection[] = []
  const known = new Set<string>()
  for (const g of [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)) {
    known.add(g.name)
    sections.push({
      key: g.name,
      name: g.name,
      groupId: g.id,
      snippets: sortSnips(byGroup.get(g.name) ?? []),
    })
  }
  // Orphaned group names (no SnippetGroup row) still render.
  for (const [key, list] of byGroup) {
    if (key !== UNGROUPED_KEY && !known.has(key)) {
      sections.push({ key, name: key, groupId: null, snippets: sortSnips(list) })
    }
  }
  sections.push({
    key: UNGROUPED_KEY,
    name: UNGROUPED_LABEL,
    groupId: null,
    snippets: sortSnips(byGroup.get(UNGROUPED_KEY) ?? []),
  })
  return sections
}

/** Case-insensitive duplicate check for the editor's live validation. */
export function abbreviationTaken(
  snippets: Snippet[],
  abbreviation: string,
  excludeId: number | null = null,
): boolean {
  const needle = abbreviation.trim().toLowerCase()
  if (!needle) return false
  return snippets.some(
    (s) => s.id !== excludeId && s.abbreviation.trim().toLowerCase() === needle,
  )
}
