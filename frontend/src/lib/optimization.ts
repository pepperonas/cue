// Pure rules of the optimization feature — the panel only renders them.
import type { Optimization, Prompt } from './types'

/**
 * The versions worth showing: a job that failed or was canceled produced no
 * text, so it is history, not a version. Shared by the panel and the pinned
 * decision bar so both look at exactly the same list.
 */
export function succeededVersions(history: Optimization[] | undefined): Optimization[] {
  return (history ?? []).filter((row) => row.status === 'succeeded')
}

/**
 * The proposal awaiting a decision, or null.
 *
 * Two conditions, and the first one is the important one: `prompt.optimized`
 * means "a result is currently held open for review". Without that guard an
 * undecided row further back in the history (a job that finished while the
 * prompt was already decided elsewhere, a restored backup) would raise a
 * decision bar for a version that is NOT what the prompt is offering — and
 * applying it would overwrite the text with something the user never saw in
 * the diff above the buttons.
 */
export function pendingProposal(
  prompt: Pick<Prompt, 'optimized'>,
  versions: Optimization[],
): Optimization | null {
  if (!prompt.optimized) return null
  return versions.find((row) => row.decision === 'pending') ?? null
}
