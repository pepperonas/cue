import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { repositoryError } from '../lib/ai-setup'
import { connectGitHub } from '../lib/github-connect'
import { clock } from '../lib/clock'
import { contextStatus } from '../lib/project-context'
import type { Project } from '../lib/types'
import { useGitHubRepos, useGitHubStatus, useRefreshProjectContext, useUpdateProject } from '../state/queries'
import { useToast } from '../state/toast'
import { Select } from './Select'
import { Button } from './ui'

export function ProjectRepository({ project, onOpenBoard, initiallyOpen = false }: { project: Project; onOpenBoard: () => void; initiallyOpen?: boolean }) {
  const { data: github } = useGitHubStatus()
  const [editing, setEditing] = useState(initiallyOpen)
  const container = useRef<HTMLDivElement>(null)
  const [saveError, setSaveError] = useState('')
  const [repo, setRepo] = useState(project.github_repo ?? '')
  const [ref, setRef] = useState(project.github_ref ?? '')
  const [search, setSearch] = useState('')
  const repos = useGitHubRepos(editing && !!github?.configured && !!github.connected)
  const update = useUpdateProject()
  const refresh = useRefreshProjectContext()
  const toast = useToast()
  const now = useSyncExternalStore(clock.subscribe, clock.now)
  useEffect(() => {
    if (initiallyOpen) container.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [initiallyOpen])
  if (!github?.configured) return null
  const busy = update.isPending || refresh.isPending
  const invalid = repositoryError(repo)

  return (
    <div ref={container} className="project-repository" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="muted" style={{ fontSize: '0.8rem', overflowWrap: 'anywhere' }} role="status">
        {contextStatus(project, now)}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        <Button variant="text" icon="code" disabled={busy} onClick={() => {
          setRepo(project.github_repo ?? ''); setRef(project.github_ref ?? '')
          setSearch(''); setSaveError(''); setEditing(!editing)
        }}>Repository {project.github_repo ? 'ändern' : 'verknüpfen'}</Button>
        {!github.connected && <Button variant="tonal" icon="link" onClick={() => connectGitHub({ view: 'projects', projectId: project.id })}>GitHub verbinden</Button>}
        {project.context?.chars && !project.context.error ? <Button variant="tonal" icon="arrow_forward" onClick={onOpenBoard}>Zum Projekt-Board</Button> : null}
        {project.github_repo && <Button variant="text" icon="refresh" disabled={busy || !github.connected}
          onClick={() => refresh.mutate(project.id, {
            onSuccess: (p) => toast.show(p.context?.error || 'Projektkontext aktualisiert', p.context?.error ? 'error' : 'success'),
            onError: (e) => toast.show(e.message, 'error'),
          })}>{refresh.isPending ? 'Lädt …' : 'Aktualisieren'}</Button>}
      </div>
      {editing && <div className="repository-editor">
        {!github.connected && <p className="muted">Verbinde dein GitHub-Konto über den Knopf oben. Danach kehrst du direkt zu diesem Projekt zurück.</p>}
        {github.connected && <>
          <label className="field" htmlFor={`repo-search-${project.id}`}>Repositories suchen
            <input id={`repo-search-${project.id}`} className="input" value={search} placeholder="Name filtern …" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Select value={repo} ariaLabel={`Repository für ${project.name} auswählen`} placeholder={repos.isFetching ? 'Repositories laden …' : 'Repository auswählen'}
            options={(repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase())).map((r) => ({ value: r.full_name, label: `${r.full_name}${r.private ? ' · privat' : ''}` }))}
            disabled={repos.isFetching || !repos.data?.length}
            onChange={(value) => { setRepo(value); setRef(''); setSaveError('') }} />
          {!repos.isFetching && repos.data && !repos.data.some((r) => r.full_name.toLowerCase().includes(search.toLowerCase())) && <p className="muted">Kein passendes Repository gefunden. Du kannst die GitHub-URL unten direkt einfügen.</p>}
          {repos.isError && <p className="muted" role="alert">{repos.error.message} — Repository kann auch direkt eingegeben werden. <Button variant="text" onClick={() => repos.refetch()}>Erneut laden</Button></p>}
        </>}
        {github.connected && <>
        <label className="field" htmlFor={`repo-${project.id}`}>Repository oder GitHub-URL
          <input id={`repo-${project.id}`} className="input" value={repo} placeholder="owner/repository" aria-invalid={!!repo.trim() && !!invalid} onChange={(e) => { setRepo(e.target.value); setSaveError('') }} disabled={busy} />
        </label>
        <label className="field" htmlFor={`ref-${project.id}`}>Branch oder Tag (optional)
          <input id={`ref-${project.id}`} className="input" value={ref} placeholder="Standard-Branch" onChange={(e) => setRef(e.target.value)} disabled={busy} />
        </label>
        {repo.trim() && invalid && <p className="opt-error" role="alert">{invalid}</p>}
        {saveError && <p className="opt-error" role="alert">{saveError}</p>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button icon="check" disabled={busy || !!invalid} onClick={() => update.mutate({ id: project.id, patch: { github_repo: repo.trim(), github_ref: ref.trim() } }, {
            onSuccess: (p) => { setEditing(false); toast.show(p.context?.error || 'Repository gespeichert', p.context?.error ? 'error' : 'success') },
            onError: (e) => setSaveError(e.message),
          })}>{update.isPending ? 'Kontext wird geladen …' : 'Speichern & Kontext laden'}</Button>
          <Button variant="text" disabled={busy} onClick={() => setEditing(false)}>Abbrechen</Button>
          {project.github_repo && <Button variant="text" icon="link_off" disabled={busy} onClick={() => update.mutate({ id: project.id, patch: { github_repo: '', github_ref: '' } }, {
            onSuccess: () => { setEditing(false); toast.show('Repository-Verknüpfung entfernt', 'success') },
            onError: (e) => toast.show(e.message, 'error'),
          })}>Verknüpfung entfernen</Button>}
        </div>
        </>}
      </div>}
    </div>
  )
}
