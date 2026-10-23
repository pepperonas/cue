import type { GitHubStatus, Project } from './types'

export interface GitHubDestination { view: 'settings' | 'projects'; projectId?: number }
export const GITHUB_RETURN_KEY = 'cue-github-return'

/** Only internal views and positive project ids can survive the OAuth round trip. */
export function githubDestination(raw: string | null): GitHubDestination {
  try {
    const parsed = JSON.parse(raw || 'null')
    if (parsed?.view === 'projects') {
      return { view: 'projects', ...(Number.isSafeInteger(parsed.projectId) && parsed.projectId > 0 ? { projectId: parsed.projectId } : {}) }
    }
  } catch { /* damaged or unavailable storage starts at settings */ }
  return { view: 'settings' }
}

export function setupProgress({ aiReady, github, projects }: {
  aiReady: boolean
  github: GitHubStatus | undefined
  projects: Project[]
}) {
  const contextReady = projects.some((p) => p.github_repo && p.context?.head_sha && p.context.chars > 0 && !p.context.error)
  const connected = !!github?.configured && !!github.connected
  const done = [aiReady, connected, contextReady]
  return { done, complete: done.every(Boolean), count: done.filter(Boolean).length }
}

export function repositoryError(value: string): string | null {
  const repo = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')
  if (!repo) return 'Wähle ein Repository aus oder füge seine GitHub-URL ein.'
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) ? null : 'Verwende owner/repository oder https://github.com/owner/repository.'
}
