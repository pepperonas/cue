import { describe, expect, it } from 'vitest'
import { githubDestination, repositoryError, setupProgress } from './ai-setup'
import type { Project } from './types'

const github = { configured: true, connected: true, login: 'octo' }
const project: Project = { id: 1, name: 'app', color: '#6750A4', sort_order: 0, created_at: '', prompt_count: 0, github_repo: 'octo/app', context: { repo: 'octo/app', ref: 'main', head_sha: 'abc1234', chars: 42, error: null, fetched_at: null } }

describe('guided AI setup', () => {
  it('keeps first-time users at zero until actual capabilities are present', () => {
    expect(setupProgress({ aiReady: false, github: undefined, projects: [] })).toEqual({ done: [false, false, false], count: 0, complete: false })
    expect(setupProgress({ aiReady: false, github, projects: [project] })).toEqual({ done: [false, true, true], count: 2, complete: false })
  })
  it('accepts the owner CLI and a loaded context as ready without demanding an API key', () => {
    expect(setupProgress({ aiReady: true, github, projects: [project] })).toEqual({ done: [true, true, true], count: 3, complete: true })
  })
  it('does not count stale failed, empty or unlinked context as a completed step', () => {
    for (const p of [ { ...project, github_repo: null }, { ...project, context: null }, { ...project, context: { ...project.context!, chars: 0 } }, { ...project, context: { ...project.context!, head_sha: '' } }, { ...project, context: { ...project.context!, error: 'Kein Zugriff' } } ]) {
      expect(setupProgress({ aiReady: true, github, projects: [p] }).done[2]).toBe(false)
    }
    expect(setupProgress({ aiReady: true, github: { ...github, connected: false }, projects: [] }).done[1]).toBe(false)
    expect(setupProgress({ aiReady: true, github: { ...github, configured: false }, projects: [] }).done[1]).toBe(false)
  })
  it('validates repository names and GitHub URLs before submitting', () => {
    for (const value of ['octo/app', ' https://github.com/octo/app.git ', 'octo/app/']) expect(repositoryError(value)).toBeNull()
    for (const value of ['', 'app', 'https://example.com/octo/app', 'octo/app extra', 'octo/app/sub']) expect(repositoryError(value)).toBeTruthy()
  })
})

describe('OAuth return destination', () => {
  it('returns to the selected project after connection or cancellation', () => {
    expect(githubDestination('{"view":"projects","projectId":17}')).toEqual({ view: 'projects', projectId: 17 })
  })
  it('ignores external views and malformed storage', () => {
    for (const value of [null, '', 'broken', 'null', '{"view":"https://evil.example"}', '{"view":"settings","projectId":17}']) expect(githubDestination(value)).toEqual({ view: 'settings' })
  })
  it('rejects invalid project ids while keeping the internal projects destination', () => {
    for (const projectId of [-1, 0, 1.2, '1', null, 9007199254740992]) expect(githubDestination(JSON.stringify({ view: 'projects', projectId }))).toEqual({ view: 'projects' })
  })
})
