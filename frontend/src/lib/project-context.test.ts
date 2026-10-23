import { describe, expect, it } from 'vitest'
import { contextSnapshot, contextStatus } from './project-context'
import type { ProjectContext } from './types'

const now = Date.parse('2026-10-23T20:00:00Z')
const context: ProjectContext = { repo: 'octo/app', ref: 'main', head_sha: 'abc123456789', chars: 41000, fetched_at: '2026-10-23T18:00:00Z', error: null }

describe('project context status', () => {
  it('explains absent links, unloaded context and failed first fetches', () => {
    expect(contextStatus({}, now)).toBe('Ohne Kontext: kein Repository verknüpft')
    expect(contextStatus({ github_repo: 'octo/app' }, now)).toBe('Ohne Kontext: noch nicht geladen')
    expect(contextStatus({ github_repo: 'octo/app', context: { ...context, chars: 0, error: 'Kein Zugriff' } }, now)).toBe('Ohne Kontext: Kein Zugriff')
  })
  it('shows source, short SHA, age and character budget', () => {
    expect(contextStatus({ github_repo: 'octo/app', context }, now)).toBe('octo/app @ abc1234 · vor 2 Stunden · 41.000 Zeichen')
  })
  it('keeps a last good snapshot visibly stale when refreshing fails', () => {
    expect(contextStatus({ github_repo: 'octo/app', context: { ...context, error: 'GitHub offline' } }, now)).toContain('Letzter Stand, Aktualisierung fehlgeschlagen: GitHub offline')
  })
  it('uses a run snapshot rather than the current repository', () => {
    expect(contextSnapshot('old/repo@deadbee')).toBe('Mit Projektkontext: old/repo@deadbee')
    expect(contextSnapshot()).toBe('Ohne Projektkontext: kein Kontext im Lauf gespeichert')
    expect(contextSnapshot('')).toBe('Ohne Projektkontext: kein Kontext im Lauf gespeichert')
  })
})
