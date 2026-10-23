import { useState, useSyncExternalStore } from 'react'
import { clock } from '../lib/clock'
import { contextStatus } from '../lib/project-context'
import type { Project } from '../lib/types'
import { useGitHubRepos, useGitHubStatus, useRefreshProjectContext, useUpdateProject } from '../state/queries'
import { useToast } from '../state/toast'
import { Select } from './Select'
import { Button } from './ui'

export function ProjectRepository({ project }: { project: Project }) {
  const { data: github } = useGitHubStatus()
  const [editing, setEditing] = useState(false)
  const [repo, setRepo] = useState(project.github_repo ?? '')
  const [ref, setRef] = useState(project.github_ref ?? '')
  const [search, setSearch] = useState('')
  const repos = useGitHubRepos(editing && !!github?.configured && !!github.connected)
  const update = useUpdateProject()
  const refresh = useRefreshProjectContext()
  const toast = useToast()
  const now = useSyncExternalStore(clock.subscribe, clock.now)
  if (!github?.configured) return null
  const busy = update.isPending || refresh.isPending

  return (
    <div className="project-repository" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="muted" style={{ fontSize: '0.8rem', overflowWrap: 'anywhere' }} role="status">
        {contextStatus(project, now)}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        <Button variant="text" icon="code" disabled={busy} onClick={() => {
          setRepo(project.github_repo ?? ''); setRef(project.github_ref ?? '')
          setSearch(''); setEditing(!editing)
        }}>Repository {project.github_repo ? 'ändern' : 'verknüpfen'}</Button>
        {project.github_repo && <Button variant="text" icon="refresh" disabled={busy || !github.connected}
          onClick={() => refresh.mutate(project.id, {
            onSuccess: (p) => toast.show(p.context?.error || 'Projektkontext aktualisiert', p.context?.error ? 'error' : 'success'),
            onError: (e) => toast.show(e.message, 'error'),
          })}>{refresh.isPending ? 'Lädt …' : 'Aktualisieren'}</Button>}
      </div>
      {editing && <div className="repository-editor">
        {!github.connected && <p className="muted">Verbinde zuerst GitHub in den Einstellungen, um Kontext zu laden.</p>}
        {github.connected && <>
          <label className="field" htmlFor={`repo-search-${project.id}`}>Repositories suchen
            <input id={`repo-search-${project.id}`} className="input" value={search} placeholder="Name filtern …" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Select value="" ariaLabel={`Repository für ${project.name} auswählen`} placeholder={repos.isFetching ? 'Repositories laden …' : 'Repository auswählen'}
            options={(repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase())).map((r) => ({ value: r.full_name, label: `${r.full_name}${r.private ? ' · privat' : ''}` }))}
            onChange={(value) => setRepo(value)} />
          {repos.isError && <p className="muted" role="alert">{repos.error.message} — Repository kann auch direkt eingegeben werden.</p>}
        </>}
        <label className="field" htmlFor={`repo-${project.id}`}>Repository oder GitHub-URL
          <input id={`repo-${project.id}`} className="input" value={repo} placeholder="owner/repository" onChange={(e) => setRepo(e.target.value)} disabled={busy} />
        </label>
        <label className="field" htmlFor={`ref-${project.id}`}>Branch oder Tag (optional)
          <input id={`ref-${project.id}`} className="input" value={ref} placeholder="Standard-Branch" onChange={(e) => setRef(e.target.value)} disabled={busy} />
        </label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button icon="check" disabled={busy} onClick={() => update.mutate({ id: project.id, patch: { github_repo: repo.trim(), github_ref: ref.trim() } }, {
            onSuccess: (p) => { setEditing(false); toast.show(p.context?.error || 'Repository gespeichert', p.context?.error ? 'error' : 'success') },
            onError: (e) => toast.show(e.message, 'error'),
          })}>{update.isPending ? 'Speichert …' : 'Speichern'}</Button>
          <Button variant="text" disabled={busy} onClick={() => setEditing(false)}>Abbrechen</Button>
          {project.github_repo && <Button variant="text" icon="link_off" disabled={busy} onClick={() => update.mutate({ id: project.id, patch: { github_repo: '', github_ref: '' } }, {
            onSuccess: () => { setEditing(false); toast.show('Repository-Verknüpfung entfernt', 'success') },
            onError: (e) => toast.show(e.message, 'error'),
          })}>Verknüpfung entfernen</Button>}
        </div>
      </div>}
    </div>
  )
}
