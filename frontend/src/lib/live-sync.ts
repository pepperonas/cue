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

export interface ChangeLoopOptions {
  /** Performs one request. Rejects on network failure; aborts via the signal. */
  fetchChanges: (since: string | null, wait: number, signal: AbortSignal) => Promise<ChangeFeed>
  /** Called once per query key that a batch of changes invalidates. */
  invalidate: (key: string[]) => void
  /** Whether the tab is currently hidden. */
  isHidden?: () => boolean
}

export interface ChangeLoop {
  start(): void
  stop(): void
  /** Conditions changed (tab shown/hidden, network back): re-evaluate now. */
  wake(): void
  cursor(): string | null
  running(): boolean
}

/**
 * The polling loop itself, with no React and no browser globals in it.
 *
 * It lives here rather than inside `useLiveSync` because everything worth
 * getting wrong is in these thirty lines: which request carries a cursor and
 * which does not, that a failure must not advance the cursor, that a hidden
 * tab drops its parked request, and that none of the wake-ups can start a
 * second loop alongside the first. A hook would hide all of that behind a
 * renderer.
 */
export function createChangeLoop(opts: ChangeLoopOptions): ChangeLoop {
  const isHidden = opts.isHidden ?? (() => false)
  let cursor: string | null = null
  let stopped = false
  let running = false
  let inFlight: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let cutShort: (() => void) | null = null
  let failures = 0

  // A backoff that can be cut short: coming back online is exactly the moment
  // to retry, and sitting out the remaining half minute would make
  // reconnecting feel broken.
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        if (timer) clearTimeout(timer)
        timer = null
        cutShort = null
        resolve()
      }
      cutShort = done
      timer = setTimeout(done, ms)
    })

  async function run() {
    if (running) return
    running = true
    try {
      while (!stopped && !isHidden()) {
        const controller = new AbortController()
        inFlight = controller
        try {
          // The first pass asks WITHOUT a cursor: it only collects the starting
          // point, so a client that has just loaded its lists does not
          // immediately load them all again.
          const feed = await opts.fetchChanges(cursor, cursor ? WAIT_SECONDS : 0, controller.signal)
          if (stopped) return
          cursor = feed.cursor
          failures = 0
          for (const key of keysToInvalidate(feed.changed ?? [])) opts.invalidate(key)
        } catch {
          if (stopped || controller.signal.aborted) return
          // A dropped connection, a redeploy, a closed lid. The cursor stays
          // where it was, so nothing that happened meanwhile is skipped.
          failures += 1
          await sleep(backoffMs(failures))
        } finally {
          inFlight = null
        }
      }
    } finally {
      running = false
    }
  }

  return {
    start() {
      stopped = false
      void run()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      cutShort = null
      inFlight?.abort()
    },
    wake() {
      if (stopped) return
      if (isHidden()) {
        // Drop the parked request rather than make the server hold it open for
        // a tab nobody is looking at.
        inFlight?.abort()
        return
      }
      cutShort?.()
      void run()
    },
    cursor: () => cursor,
    running: () => running,
  }
}
