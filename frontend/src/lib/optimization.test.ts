import { describe, expect, it } from 'vitest'
import { pendingProposal } from './optimization'
import type { Optimization } from './types'

function version(v: number, decision: Optimization['decision']): Optimization {
  return {
    id: v,
    prompt_id: 1,
    batch_id: null,
    version: v,
    status: 'succeeded',
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
