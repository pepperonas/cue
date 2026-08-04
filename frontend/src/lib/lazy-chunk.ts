// Recovery for a lazily loaded chunk that is no longer on the server.
//
// Every deploy emits new content-hashed files and drops the old ones, so a tab
// that was already open asks for a chunk that has since been deleted and the
// dynamic import rejects. Cache headers cannot help here — the shell in that
// tab was fetched before the deploy. Reloading gets the shell that matches
// what is actually deployed.
//
// The flag makes it exactly ONE reload per failure: a chunk that is broken for
// any other reason must not put the app in a reload loop. A later successful
// load clears it, so the next deploy gets its own attempt.

export interface ChunkEnv {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  reload(): void
}

function flagFor(key: string): string {
  return `cue-chunk-reload:${key}`
}

/** Reload once to pick up the current shell. True when a reload was started —
 *  the caller must then stall instead of surfacing the error. */
export function recoverFromMissingChunk(key: string, env: ChunkEnv): boolean {
  const flag = flagFor(key)
  if (env.getItem(flag)) return false
  env.setItem(flag, '1')
  env.reload()
  return true
}

/** A chunk loaded — the next failure may reload again. */
export function clearChunkRecovery(key: string, env: ChunkEnv): void {
  env.removeItem(flagFor(key))
}

export function browserChunkEnv(): ChunkEnv {
  return {
    getItem: (k) => sessionStorage.getItem(k),
    setItem: (k, v) => sessionStorage.setItem(k, v),
    removeItem: (k) => sessionStorage.removeItem(k),
    reload: () => window.location.reload(),
  }
}

/** Wrap a `() => import(...)` for `React.lazy`. */
export function withChunkRecovery<T>(
  key: string,
  load: () => Promise<T>,
  env: ChunkEnv = browserChunkEnv(),
): () => Promise<T> {
  return () =>
    load().then(
      (mod) => {
        clearChunkRecovery(key, env)
        return mod
      },
      (err) => {
        // Never resolves on purpose: the page is on its way out, and Suspense
        // should keep showing its fallback rather than flash an error first.
        if (recoverFromMissingChunk(key, env)) return new Promise<T>(() => {})
        throw err
      },
    )
}
