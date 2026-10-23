import { api } from './api'
import { GITHUB_RETURN_KEY, type GitHubDestination } from './ai-setup'

export function connectGitHub(destination: GitHubDestination = { view: 'settings' }): void {
  try { sessionStorage.setItem(GITHUB_RETURN_KEY, JSON.stringify(destination)) } catch { /* connection still works without storage */ }
  window.location.href = api.githubConnectUrl
}

export function savedGitHubDestination(): string | null {
  try { return sessionStorage.getItem(GITHUB_RETURN_KEY) } catch { return null }
}
