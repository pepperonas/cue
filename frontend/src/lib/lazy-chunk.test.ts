import { describe, expect, it, vi } from 'vitest'
import {
  clearChunkRecovery,
  recoverFromMissingChunk,
  withChunkRecovery,
  type ChunkEnv,
} from './lazy-chunk'

function env(): ChunkEnv & { reloads: number; store: Map<string, string> } {
  const store = new Map<string, string>()
  const e = {
    store,
    reloads: 0,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    reload: () => {
      e.reloads += 1
    },
  }
  return e
}

describe('recoverFromMissingChunk', () => {
  it('reloads once so the tab picks up the deployed shell', () => {
    const e = env()
    expect(recoverFromMissingChunk('stats', e)).toBe(true)
    expect(e.reloads).toBe(1)
  })

  it('never reloads a second time for the same chunk', () => {
    // The whole point of the flag: a chunk that is broken for some other
    // reason would otherwise reload the app forever.
    const e = env()
    recoverFromMissingChunk('stats', e)
    expect(recoverFromMissingChunk('stats', e)).toBe(false)
    expect(e.reloads).toBe(1)
  })

  it('keeps separate chunks independent', () => {
    const e = env()
    recoverFromMissingChunk('stats', e)
    expect(recoverFromMissingChunk('other', e)).toBe(true)
    expect(e.reloads).toBe(2)
  })

  it('arms again once the chunk has loaded', () => {
    // Otherwise the first deploy in a session would consume the only attempt
    // and the second one would surface the error.
    const e = env()
    recoverFromMissingChunk('stats', e)
    clearChunkRecovery('stats', e)
    expect(recoverFromMissingChunk('stats', e)).toBe(true)
    expect(e.reloads).toBe(2)
  })
})

describe('withChunkRecovery', () => {
  it('passes the module through untouched', async () => {
    const e = env()
    const mod = { default: 'component' }
    await expect(withChunkRecovery('stats', () => Promise.resolve(mod), e)()).resolves.toBe(mod)
    expect(e.reloads).toBe(0)
  })

  it('stalls instead of rejecting while the reload runs', async () => {
    const e = env()
    const load = withChunkRecovery('stats', () => Promise.reject(new Error('404')), e)
    const settled = vi.fn()
    void load().then(settled, settled)
    await Promise.resolve()
    await Promise.resolve()
    expect(e.reloads).toBe(1)
    // Suspense keeps its fallback up; surfacing the error would flash a broken
    // screen for the moment before the page goes away.
    expect(settled).not.toHaveBeenCalled()
  })

  it('surfaces the error when a reload already failed to fix it', async () => {
    const e = env()
    const load = withChunkRecovery('stats', () => Promise.reject(new Error('boom')), e)
    void load().catch(() => {})
    await Promise.resolve()
    await expect(load()).rejects.toThrow('boom')
    expect(e.reloads).toBe(1)
  })

  it('re-arms after a load that succeeds', async () => {
    const e = env()
    let fail = true
    const load = withChunkRecovery(
      'stats',
      () => (fail ? Promise.reject(new Error('404')) : Promise.resolve({ default: 'ok' })),
      e,
    )
    void load()
    await Promise.resolve()
    fail = false
    await load()
    fail = true
    void load()
    await Promise.resolve()
    expect(e.reloads).toBe(2)
  })
})
