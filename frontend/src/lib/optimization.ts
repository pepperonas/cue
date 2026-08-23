// Pure rules of the optimization feature — the panel only renders them.
import type { Optimization, Prompt } from './types'

/**
 * The three states the ✨-button communicates, as one explicit value.
 *
 * Derived once, here, instead of re-deriving `prompt.optimized` and
 * `optimization_applied_at` at each call site — the two conditions can hold at
 * the same time (a prompt that was optimized last week and has a fresh
 * proposal waiting), and the answer to that has to be the same everywhere.
 *
 * **Rank: `pending` beats `applied`.** The pending state is the one that asks
 * something of the user; "wurde schon einmal optimiert" is only history and
 * stays readable in the panel either way. Showing the green "done" tint over an
 * undecided proposal would hide the request for a decision.
 */
export type OptimizeState = 'none' | 'pending' | 'applied'

export function optimizeState(
  prompt: Pick<Prompt, 'optimized' | 'optimization_applied_at'>,
): OptimizeState {
  if (prompt.optimized) return 'pending'
  return prompt.optimization_applied_at ? 'applied' : 'none'
}

/**
 * Whether a prompt may be optimized at all.
 *
 * Optimizing is PREPARATION — it rewrites the text you are about to send. Once
 * a prompt is running or done that text has already been used, so offering the
 * rewrite there costs money for a result nobody will send; failed and archived
 * prompts are out for the same reason, and moving one back to the queue makes
 * it eligible again. The server enforces the same rule in
 * `optimization/service.py:_queue_for`, so hiding the button is a courtesy,
 * not the guard.
 */
export function isOptimizable(prompt: Pick<Prompt, 'status'>): boolean {
  return prompt.status === 'queued'
}

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
