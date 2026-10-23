import { formatAge, parseTimestamp } from './relative-time'
import type { Project } from './types'

/** Cache status and run snapshots are different: history must keep its own SHA. */
export function contextStatus(project: Pick<Project, 'github_repo' | 'context'>, now: number): string {
  if (!project.github_repo) return 'Ohne Kontext: kein Repository verknüpft'
  const ctx = project.context
  if (!ctx?.head_sha || !ctx.chars) return `Ohne Kontext: ${ctx?.error || 'noch nicht geladen'}`
  const stamp = parseTimestamp(ctx.fetched_at)
  const age = stamp === null ? '' : ` · ${formatAge(stamp, now)}`
  const status = `${ctx.repo} @ ${ctx.head_sha.slice(0, 7)}${age} · ${ctx.chars.toLocaleString('de-DE')} Zeichen`
  return ctx.error ? `${status} · Letzter Stand, Aktualisierung fehlgeschlagen: ${ctx.error}` : status
}

export function contextSnapshot(ref?: string): string {
  return ref ? `Mit Projektkontext: ${ref}` : 'Ohne Projektkontext: kein Kontext im Lauf gespeichert'
}
