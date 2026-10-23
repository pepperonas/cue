import { setupProgress } from '../lib/ai-setup'
import type { Project } from '../lib/types'
import { useGitHubStatus, useOptimizeConfig } from '../state/queries'
import { ApiKeySection } from './ApiKeySection'
import { GitHubSection } from './GitHubSection'
import { Button, Icon } from './ui'

export function AiSetupSection({ projects, onProjects }: { projects: Project[]; onProjects: () => void }) {
  const github = useGitHubStatus()
  const config = useOptimizeConfig()
  const progress = setupProgress({ aiReady: !!config.data?.enabled, github: github.data, projects })
  return (
    <section className="section ai-setup" id="ai-setup" aria-labelledby="ai-setup-title">
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 id="ai-setup-title">KI mit Projektkontext</h2>
        <span className="setup-progress" role="status">{progress.complete ? 'Bereit' : `${progress.count} von 3 Schritten erledigt`}</span>
      </div>
      <p className="muted">Lass deine Prompts verbessern und in eine sinnvolle Reihenfolge bringen. Mit GitHub kennt die KI auch den Stand deines Projekts. Einmal einrichten, dann direkt im Projekt arbeiten.</p>
      <ol className="setup-checklist" aria-label="Einrichtungsfortschritt">
        {['KI-Zugang', 'GitHub verbinden', 'Repository auswählen'].map((label, i) => <li key={label} data-done={progress.done[i]}><Icon name={progress.done[i] ? 'check_circle' : 'radio_button_unchecked'} /> {label}</li>)}
      </ol>
      {config.data && !config.data.enabled && <p className="opt-error" role="status">Der Betreiber hat KI-Läufe derzeit deaktiviert. Deine gespeicherten Einstellungen bleiben erhalten.</p>}
      <ApiKeySection />
      <GitHubSection onProjects={onProjects} />
      <div className="ai-setup-step">
        <h3><span className="setup-number">3</span> Projekt mit Repository verknüpfen</h3>
        <p className="muted">Wähle unter Projekte dein GitHub-Repository aus. cue lädt den Kontext beim Speichern automatisch. Anschließend kannst du im Board ein Projekt auswählen und „Projekt analysieren“ oder „Alle optimieren“ starten.</p>
        {progress.done[2] && <p className="setup-success"><Icon name="check_circle" /> Projektkontext wurde geladen.</p>}
        <Button variant="tonal" icon="folder" onClick={onProjects}>{projects.length ? 'Repository für ein Projekt auswählen' : 'Erstes Projekt anlegen'}</Button>
        <p className="muted setup-note">GitHub ist optional: Mit deinem KI-Zugang kannst du auch ohne Repository arbeiten. Änderungen an Prompts oder ihrer Reihenfolge werden erst nach deiner Bestätigung übernommen.</p>
      </div>
    </section>
  )
}
