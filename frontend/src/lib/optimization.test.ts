import { describe, expect, it } from 'vitest'
import { metaChanges, pendingProposal, succeededVersions } from './optimization'
import type { Optimization } from './types'

function version(
  v: number,
  decision: Optimization['decision'],
  status: Optimization['status'] = 'succeeded',
): Optimization {
  return {
    id: v,
    prompt_id: 1,
    batch_id: null,
    version: v,
    status,
    provider: 'claude_cli',
    model: 'claude',
    meta_prompt_version: 3,
    universal: false,
    decision,
    decided_at: decision === 'pending' ? null : '2026-07-29T10:00:00Z',
    original_text: 'a',
    previous_text: null,
    optimized_text: 'b',
    exit_code: 0,
    duration_ms: 10,
    cost_usd: 0.1,
    input_tokens: 1,
    output_tokens: 1,
    error: null,
    created_at: '2026-07-29T09:00:00Z',
    started_at: '2026-07-29T09:00:00Z',
    finished_at: '2026-07-29T09:00:01Z',
  } as Optimization
}

describe('pendingProposal', () => {
  it('finds the undecided version while one is held open', () => {
    const found = pendingProposal({ optimized: true }, [version(2, 'pending'), version(1, 'applied')])
    expect(found?.version).toBe(2)
  })

  it('returns null once every version has been decided', () => {
    expect(
      pendingProposal({ optimized: true }, [version(2, 'discarded'), version(1, 'applied')]),
    ).toBeNull()
  })

  it('returns null when the prompt holds nothing open, even if a row says pending', () => {
    // The guard that matters: an undecided row further back in the history must
    // not raise a decision bar for something the prompt is not offering —
    // applying it would overwrite the text with a version never shown in the
    // diff above the buttons.
    expect(pendingProposal({ optimized: false }, [version(1, 'pending')])).toBeNull()
  })

  it('handles a prompt without any optimization at all', () => {
    expect(pendingProposal({ optimized: false }, [])).toBeNull()
    expect(pendingProposal({ optimized: true }, [])).toBeNull()
  })
})

describe('pendingProposal with a superseded version', () => {
  it('picks the version that is still open, not the replaced one', () => {
    // Optimizing twice without deciding replaces the older proposal; only the
    // newer one may be offered for review.
    const found = pendingProposal({ optimized: true }, [
      version(2, 'pending'),
      version(1, 'superseded'),
    ])
    expect(found?.version).toBe(2)
  })

  it('offers nothing when every version was replaced or decided', () => {
    expect(
      pendingProposal({ optimized: true }, [version(2, 'applied'), version(1, 'superseded')]),
    ).toBeNull()
  })
})

describe('succeededVersions', () => {
  it('keeps only the attempts that actually produced a text', () => {
    const kept = succeededVersions([
      version(3, 'pending', 'running'),
      version(2, 'pending'),
      version(1, 'pending', 'failed'),
      version(0, 'pending', 'canceled'),
    ])
    expect(kept.map((row) => row.version)).toEqual([2])
  })

  it('preserves the order it was given (newest first)', () => {
    const kept = succeededVersions([version(3, 'applied'), version(2, 'discarded'), version(1, 'applied')])
    expect(kept.map((row) => row.version)).toEqual([3, 2, 1])
  })

  it('treats a missing history as empty', () => {
    expect(succeededVersions(undefined)).toEqual([])
  })
})

describe('succeededVersions feeding pendingProposal', () => {
  // The two are always used together — the panel renders the diff from this
  // list and the pinned decision bar reads the same one, so they can never
  // disagree about what is being applied.
  it('never offers a failed attempt for review', () => {
    // A failed job carries decision 'pending' (nobody decided it) and no text.
    // Unfiltered it would raise a decision bar whose "Übernehmen" writes null
    // over the prompt.
    const history = [version(2, 'pending', 'failed'), version(1, 'applied')]
    expect(pendingProposal({ optimized: true }, succeededVersions(history))).toBeNull()
  })

  it('still offers the genuine proposal when a later attempt failed', () => {
    const history = [version(3, 'pending', 'failed'), version(2, 'pending'), version(1, 'applied')]
    const found = pendingProposal({ optimized: true }, succeededVersions(history))
    expect(found?.version).toBe(2)
  })
})

describe('metaChanges', () => {
  const attempt = (over: Partial<Optimization>): Optimization =>
    ({
      original_title: '',
      original_tags: '',
      optimized_title: null,
      optimized_tags: null,
      ...over,
    }) as Optimization

  it('reports a new title and new tags', () => {
    const out = metaChanges(
      attempt({
        original_title: 'Alt',
        optimized_title: 'Neu',
        original_tags: 'gui',
        optimized_tags: 'bugfix, gui',
      }),
    )
    expect(out.map((c) => c.key)).toEqual(['title', 'tags'])
    expect(out[0]).toMatchObject({ from: 'Alt', to: 'Neu' })
  })

  it('says nothing when the model proposed nothing', () => {
    // ⚠️ Mirrors the server: an empty proposal is not "remove everything".
    // Showing "Tags: gui → —" would announce a deletion that never happens.
    expect(metaChanges(attempt({ original_tags: 'gui', optimized_tags: null }))).toEqual([])
    expect(metaChanges(attempt({ original_tags: 'gui', optimized_tags: '' }))).toEqual([])
  })

  it('says nothing when the proposal is the value that is already there', () => {
    expect(
      metaChanges(attempt({ original_title: 'Gleich', optimized_title: '  Gleich  ' })),
    ).toEqual([])
  })

  it('shows a first-ever title as coming from nothing', () => {
    const out = metaChanges(attempt({ original_title: '', optimized_title: 'Erster' }))
    expect(out).toHaveLength(1)
    expect(out[0].from).toBe('')
  })

  it('survives having no attempt at all', () => {
    // The panel renders before the history has arrived.
    expect(metaChanges(undefined)).toEqual([])
  })
})
