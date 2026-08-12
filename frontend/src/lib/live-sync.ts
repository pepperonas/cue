/**
 * Cross-device live updates — the rules, without the React or the network.
 *
 * The backend's `/api/changes` long poll says WHICH entities moved (see
 * `app/changes.py`); this module says what that means for the cache and how
 * the loop should pace itself. Both are pure functions so they can be tested
 * without a server, a timer or a DOM.
 */

/** Entity keys as they arrive from the server. Renaming one here without
 *  renaming it there silently stops those updates — hence the shared vocabulary. */
export type ChangedEntity = 'prompts' | 'projects' | 'tags' | 'snippets' | 'sessions'

export interface ChangeFeed {
  cursor: string
  changed: ChangedEntity[]
}

/**
 * Query keys to invalidate per entity.
 *
 * Deliberately not 1:1 with the entity names — a change reaches further than
 * the list it happened in:
 *  - renaming a tag rewrites the tag strings cached on every prompt, without
 *    touching the prompts' own timestamps;
 *  - the statistics are aggregated from prompts, projects and tags, so any of
 *    the three can make an open dashboard stale;
 *  - snippets and their groups are one view and always reload together.
 */
export const INVALIDATIONS: Record<ChangedEntity, string[][]> = {
  prompts: [['prompts'], ['stats']],
  projects: [['projects'], ['stats']],
  tags: [['tags'], ['prompts'], ['stats']],
  snippets: [['snippets'], ['snippet-groups']],
  sessions: [['sessions'], ['session']],
}

/** The query keys a batch of changes should invalidate, each one only once. */
export function keysToInvalidate(changed: readonly ChangedEntity[]): string[][] {
  const seen = new Set<string>()
  const out: string[][] = []
  for (const entity of changed) {
    for (const key of INVALIDATIONS[entity] ?? []) {
      const id = key.join('/')
      if (seen.has(id)) continue
      seen.add(id)
      out.push(key)
    }
  }
  return out
}

/** How long the server may hold a request open, in seconds.
 *
 *  Must stay below the backend's own ceiling (`MAX_WAIT_S` = 25 s), which in
 *  turn stays below the reverse proxy's read timeout. */
export const WAIT_SECONDS = 25

/** Ceiling for the retry backoff. Half a minute of silence after the server
 *  goes away is long enough to be cheap and short enough that coming back
 *  feels immediate. */
export const MAX_BACKOFF_MS = 30_000

/**
 * Delay before the next attempt after `failures` consecutive errors.
 *
 * Zero after a success: the whole point of long polling is that the next
 * request goes straight back out. The backoff exists for the case where the
 * server is unreachable — a tunnel, a redeploy, a laptop lid — where retrying
 * every few milliseconds would spin the CPU and fill the console for nothing.
 */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1))
}

/**
 * Whether the loop should be running at all right now.
 *
 * A hidden tab gets nothing out of a parked request — mobile browsers freeze
 * or drop background connections anyway, and a phone that has been in a pocket
 * for an hour would hold a socket the whole time for updates nobody is looking
 * at. It catches up in one request when it comes back.
 */
export function shouldPoll(opts: { authenticated: boolean; hidden: boolean }): boolean {
  return opts.authenticated && !opts.hidden
}
