import { describe, expect, it } from 'vitest'
import { rankRepositories } from './repository-match'
import type { GitHubRepo } from './types'

const repo = (full_name: string): GitHubRepo => ({ full_name, default_branch: 'main', private: true })
const names = (repos: GitHubRepo[]) => repos.map((r) => r.full_name)

describe('repository suggestions for a project', () => {
  it('puts an exact repository name first even when it was last fetched', () => {
    expect(names(rankRepositories([repo('cue/x'), repo('octo/cue-runner'), repo('octo/rescue'), repo('octo/cue')], 'cue'))).toEqual(['octo/cue', 'octo/cue-runner', 'octo/rescue', 'cue/x'])
  })
  it('matches case, separators and domain-style project names', () => {
    const list = [repo('octo/other'), repo('octo/via-tools'), repo('octo/VIA_camp')]
    expect(rankRepositories(list, 'Via.Camp')[0].full_name).toBe('octo/VIA_camp')
    expect(rankRepositories([repo('octo/CUE-runner'), repo('octo/cue')], 'CUE')[0].full_name).toBe('octo/cue')
    expect(rankRepositories([repo('octo/via-camp-app'), repo('octo/viacamp')], 'Via.Camp')[0].full_name).toBe('octo/viacamp')
    expect(rankRepositories([repo('octo/kiez-tools'), repo('octo/kiez-form')], 'Kiez Form')[0].full_name).toBe('octo/kiez-form')
  })
  it('compares the last project path segment against the repository name', () => {
    expect(rankRepositories([repo('octo/celox-celox-portal'), repo('celox/unrelated'), repo('octo/celox'), repo('octo/celox-portal')], 'celox/celox-portal')[0].full_name).toBe('octo/celox-portal')
  })
  it('recognizes close spelling when no exact match exists', () => {
    expect(rankRepositories([repo('octo/other-tracker'), repo('octo/website'), repo('octo/token-tracker'), repo('octo/tokens')], 'token-traker')[0].full_name).toBe('octo/token-tracker')
  })
  it('keeps short project names from promoting accidental substrings above whole words', () => {
    expect(names(rankRepositories([repo('octo/api'), repo('octo/pilot'), repo('octo/raspberry-pi'), repo('octo/pi')], 'pi'))).toEqual(['octo/pi', 'octo/raspberry-pi', 'octo/pilot', 'octo/api'])
  })
  it('preserves fetched order for equally good matches and does not mutate the query cache', () => {
    const list = [repo('b/cue'), repo('a/cue'), repo('z/other')]
    const before = [...list]
    const ranked = rankRepositories(list, 'cue')
    expect(names(ranked)).toEqual(['b/cue', 'a/cue', 'z/other'])
    expect(list).toEqual(before)
    expect(ranked).not.toBe(list)
  })
  it('leaves the fetched order intact when the project name contains no usable words', () => {
    const list = [repo('z/website'), repo('a/api'), repo('b/cue')]
    expect(rankRepositories(list, '---')).toEqual(list)
    expect(rankRepositories(list, '')).toEqual(list)
  })
})
