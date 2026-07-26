// Grouping model for the mobile board.
//
// On a phone a status column is a long ribbon of cards — 111 done prompts
// spread over 36 projects are unusable. Mobile therefore splits every status
// section into collapsible project groups; this module computes those groups
// (pure, so the ordering rules are unit tested rather than eyeballed).
import type { Project, Prompt } from './types'

/** Sentinel id for prompts without a project. */
export const NO_PROJECT = 'none'

export type GroupKey = number | typeof NO_PROJECT

export interface ProjectGroup {
  key: GroupKey
  /** Stable dom/collapse id, e.g. "queued:12". */
  id: string
  name: string
  color: string
  /** Prompt ids in board order. */
  ids: number[]
}

/**
 * Split one column's prompt ids into project groups.
 *
 * Order follows the cards, not the project list: the group of the first card
 * comes first, so the visual order matches the ungrouped board and a card
 * moved to the top pulls its group along. Prompts without a project always
 * form the last group.
 */
export function groupByProject(
  ids: number[],
  byId: Map<number, Prompt>,
  projects: Map<number, Project>,
  statusKey: string,
): ProjectGroup[] {
  const groups = new Map<GroupKey, ProjectGroup>()
  for (const id of ids) {
    const prompt = byId.get(id)
    if (!prompt) continue
    const key: GroupKey = prompt.project_id ?? NO_PROJECT
    let group = groups.get(key)
    if (!group) {
      const project = prompt.project_id ? projects.get(prompt.project_id) : undefined
      group = {
        key,
        id: `${statusKey}:${key}`,
        name: project?.name ?? 'Ohne Projekt',
        color: project?.color ?? '#7d7d8a',
        ids: [],
      }
      groups.set(key, group)
    }
    group.ids.push(id)
  }
  const list = [...groups.values()]
  const noProject = list.findIndex((g) => g.key === NO_PROJECT)
  if (noProject >= 0) list.push(...list.splice(noProject, 1))
  return list
}

/**
 * Should a column's groups start expanded?
 *
 * Short columns stay open (collapsing three cards helps nobody); long ones
 * start collapsed so the column is a compact list of project headers. Once the
 * user toggles a section their choice wins for the rest of the session.
 */
export const AUTO_COLLAPSE_FROM = 12

export function defaultGroupsOpen(cardCount: number): boolean {
  return cardCount < AUTO_COLLAPSE_FROM
}

/**
 * Resolve the open state of a section: explicit user choice first, then the
 * size-based default.
 */
export function isOpen(
  overrides: Record<string, boolean>,
  id: string,
  fallback: boolean,
): boolean {
  return overrides[id] ?? fallback
}
