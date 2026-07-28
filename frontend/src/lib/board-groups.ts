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

/** Cards rendered before the "show more" cut-off. */
export const COLUMN_CAP = 10

/** Key under which a whole status column tracks its expansion. */
export const columnKey = (status: string) => `col:${status}`

export interface CapResult {
  /** Ids to render. */
  shown: number[]
  /** How many are held back by the cap (0 when everything is rendered). */
  hidden: number
}

/**
 * How many cards of a column or project group are rendered.
 *
 * Collapsed sections render nothing; otherwise the cap applies until the user
 * expands this specific group — the expansion is per group, not per status
 * column, so opening one project doesn't silently uncap its neighbours.
 *
 * The cap holds DURING a drag too. Mounting all 165 cards of a long column
 * used to be justified with "a card that isn't in the DOM can't be a drop
 * target", but a move is anchored on a neighbour and the column itself is a
 * full-height target, so precision doesn't need every card. Mounting them made
 * the column ~30 000 px tall and put 165 more droppables under continuous
 * measurement — which is how the hit testing drifted in the first place.
 */
export function visibleCards(
  ids: number[],
  opts: { open?: boolean; expanded?: boolean; cap?: number } = {},
): CapResult {
  const { open = true, expanded = false, cap = COLUMN_CAP } = opts
  if (!open) return { shown: [], hidden: ids.length }
  if (expanded || ids.length <= cap) return { shown: ids, hidden: 0 }
  return { shown: ids.slice(0, cap), hidden: ids.length - cap }
}

/**
 * Label of the cap toggle, or null when no toggle belongs there.
 *
 * Expanding must stay reversible: once a group is expanded the button turns
 * into "Weniger anzeigen" instead of disappearing.
 */
export function capToggleLabel(
  total: number,
  hidden: number,
  expanded: boolean,
  cap: number = COLUMN_CAP,
): string | null {
  if (hidden > 0) return `${hidden} weitere anzeigen`
  if (expanded && total > cap) return 'Weniger anzeigen'
  return null
}


/**
 * Open prompts (queued + running) per project, keyed by project id with
 * `NO_PROJECT` for the unassigned bucket.
 *
 * Always call this with the UNFILTERED prompt list: the counts describe the
 * whole board, so filtering to one project must not zero the other badges.
 */
export function countOpenByProject(prompts: Prompt[]): Map<number | typeof NO_PROJECT, number> {
  const counts = new Map<number | typeof NO_PROJECT, number>()
  for (const prompt of prompts) {
    if (prompt.status !== 'queued' && prompt.status !== 'running') continue
    const key: GroupKey = prompt.project_id ?? NO_PROJECT
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
