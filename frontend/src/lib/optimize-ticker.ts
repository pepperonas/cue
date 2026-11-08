// What the small status pill says while a single optimization is under way.
//
// Two phases the user could not see before: the POST itself (which is where the
// GitHub context is fetched — up to ten seconds) and the job waiting for / being
// worked on by the executor. Batches have their own ticker and are left out.
import type { Optimization, Project, Prompt } from './types'

export type TickerPhase = 'context' | 'queueing' | 'queued' | 'running'

export interface TickerState {
  phase: TickerPhase
  /** Main line, e.g. "Wird optimiert". */
  text: string
  /** Secondary line: which prompt, which context. */
  detail: string
}

const shortTitle = (p: Prompt | undefined): string => {
  const t = (p?.title || '').trim()
  return t.length > 48 ? `${t.slice(0, 47)}…` : t
}

export function optimizeTicker(
  pendingPromptIds: number[],
  active: Optimization[],
  prompts: Prompt[],
  projects: Project[],
): TickerState | null {
  const promptById = new Map(prompts.map((p) => [p.id, p]))
  const projectById = new Map(projects.map((p) => [p.id, p]))

  if (pendingPromptIds.length) {
    const prompt = promptById.get(pendingPromptIds[0])
    const project = prompt?.project_id != null ? projectById.get(prompt.project_id) : undefined
    if (project?.github_repo) {
      return {
        phase: 'context',
        text: 'Projektkontext wird von GitHub geholt…',
        detail: project.github_repo,
      }
    }
    return { phase: 'queueing', text: 'Optimierung wird gestartet…', detail: shortTitle(prompt) }
  }

  const singles = active.filter(
    (j) => j.batch_id === null && (j.status === 'queued' || j.status === 'running'),
  )
  if (!singles.length) return null
  if (singles.length > 1) {
    const running = singles.filter((j) => j.status === 'running').length
    return {
      phase: running ? 'running' : 'queued',
      text: `${singles.length} Prompts werden optimiert`,
      detail: running ? `${running} laufen gerade` : 'warten auf Ausführung',
    }
  }
  const job = singles[0]
  const title = shortTitle(promptById.get(job.prompt_id))
  const context = job.context_ref ? `mit Kontext ${job.context_ref}` : 'ohne Projektkontext'
  return {
    phase: job.status === 'running' ? 'running' : 'queued',
    text: job.status === 'running' ? 'Wird optimiert' : 'Wartet auf Ausführung',
    detail: title ? `${title} · ${context}` : context,
  }
}
