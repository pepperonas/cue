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

/**
 * Split a Done column into the prompts still to be checked and the ones already
 * marked tested.
 *
 * Takes prompts rather than ids so the board and the list view can share it —
 * they are the two places the Done column exists, and the split has to mean the
 * same thing in both.
 *
 * `columnComparator` already sinks tested below untested, so in practice the
 * two parts arrive contiguous — but this partitions rather than slices, so the
 * split stays correct if that ordering rule is ever changed. Order inside each
 * part is preserved.
 */
export function splitTested<T extends { tested: boolean }>(
  items: T[],
): { untested: T[]; tested: T[] } {
  const untested: T[] = []
  const tested: T[] = []
  for (const item of items) (item.tested ? tested : untested).push(item)
  return { untested, tested }
}

/**
 * Where the folded "tested" block remembers its state.
 *
 * ONE key for the whole board, deliberately not one per project. The project
 * chips *filter* the same board rather than switching to a different one, and
 * with "Alle" selected there is no project to key on — a per-project setting
 * would need an extra bucket for that case, and the same card would then be
 * folded in one view and unfolded in the other. Folding finished work away is
 * a preference about the Done column, not a property of a project, and the
 * board's other folds (the list view's per-status collapse, the
 * Failed/Archived toggle) are board-wide for the same reason.
 *
 * localStorage, not sessionStorage: this one has to survive a reload. The
 * mobile project groups deliberately do not — see SECTION_KEY in Board.tsx.
 */
export const TESTED_OPEN_KEY = 'cue-done-tested-open'

/** Cap key of the folded block, so it expands independently of the part above it. */
export const TESTED_CAP_KEY = 'col:done:tested'

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
 * Open prompts per project, keyed by project id with `NO_PROJECT` for the
 * unassigned bucket.
 *
 * "Open" means queued or running AND not blocked: the badge answers "how much
 * is waiting for me here", and a blocked prompt is explicitly parked — counting
 * it would inflate the number with work that cannot be picked up.
 *
 * Always call this with the UNFILTERED prompt list: the counts describe the
 * whole board, so filtering to one project must not zero the other badges.
 */
/**
 * Board order for the project chips: whatever needs attention, first.
 *
 * Projects with open prompts come first, most open first; everything else keeps
 * the order the user dragged into place (`Project.sort_order`, which is the
 * order this function receives). The manual order is also the tiebreak, so two
 * projects with the same number of open prompts still sit where they were put.
 *
 * Derived from the live prompt list, so the row re-sorts itself the moment a
 * prompt is added, finished or moved — no reload, no second request.
 */
export function sortProjectsByAttention<T extends { id: number }>(
  projects: T[],
  openCounts: Map<number | typeof NO_PROJECT, number>,
): T[] {
  const manual = new Map(projects.map((project, index) => [project.id, index]))
  return [...projects].sort((a, b) => {
    const openA = openCounts.get(a.id) ?? 0
    const openB = openCounts.get(b.id) ?? 0
    if (openA !== openB) return openB - openA
    return (manual.get(a.id) ?? 0) - (manual.get(b.id) ?? 0)
  })
}

/**
 * Rewrite the manual order after a drag among the projects with NOTHING open.
 *
 * Those are the only ones the board lets you drag: a project with open prompts
 * is placed by its count, so dropping it somewhere would be undone by the next
 * render. The ones with an empty queue have no count to overrule them, so their
 * order IS the manual one and a drag there is real.
 *
 * The head keeps its exact positions — the tail entries are permuted among the
 * slots they already occupied, so reordering the quiet projects can never
 * disturb the tiebreak order of the busy ones.
 *
 * @param manual   projects in their stored order (`Project.sort_order`)
 * @param tailIds  the draggable ids in their NEW order
 */
export function withReorderedTail<T extends { id: number }>(
  manual: T[],
  tailIds: number[],
): T[] {
  const wanted = new Set(tailIds)
  const slots: number[] = []
  manual.forEach((project, index) => {
    if (wanted.has(project.id)) slots.push(index)
  })
  if (slots.length !== tailIds.length) return manual // ids we do not know — leave it alone
  const byId = new Map(manual.map((project) => [project.id, project]))
  const next = [...manual]
  tailIds.forEach((id, position) => {
    const project = byId.get(id)
    if (project) next[slots[position]] = project
  })
  return next
}

export function countOpenByProject(prompts: Prompt[]): Map<number | typeof NO_PROJECT, number> {
  const counts = new Map<number | typeof NO_PROJECT, number>()
  for (const prompt of prompts) {
    if (prompt.blocked) continue
    if (prompt.status !== 'queued' && prompt.status !== 'running') continue
    const key: GroupKey = prompt.project_id ?? NO_PROJECT
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
