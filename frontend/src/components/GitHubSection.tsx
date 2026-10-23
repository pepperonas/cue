import { useState } from 'react'
import { connectGitHub } from '../lib/github-connect'
import { useDisconnectGitHub, useGitHubStatus } from '../state/queries'
import { useToast } from '../state/toast'
import { Button } from './ui'
import { Confirm } from './Confirm'

export function GitHubSection({ onProjects }: { onProjects: () => void }) {
  const status = useGitHubStatus()
  const github = status.data
  const disconnect = useDisconnectGitHub()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  if (status.isPending) return <div className="ai-setup-step" id="ai-github" role="status">GitHub-Verbindung wird geprüft …</div>
  if (status.isError) return <div className="ai-setup-step" id="ai-github" role="alert">GitHub-Verbindung konnte nicht geprüft werden. <Button variant="text" onClick={() => status.refetch()}>Erneut versuchen</Button></div>
  if (!github?.configured) return <div className="ai-setup-step" id="ai-github"><h3><span className="setup-number">2</span> GitHub verbinden (optional)</h3><p className="muted">GitHub ist auf dieser Instanz noch nicht eingerichtet. Der Betreiber übernimmt die Einrichtung. Du kannst mit deinem API-Key bereits ohne Projektkontext arbeiten.</p></div>

  return (
    <div className="ai-setup-step" id="ai-github">
      <h3><span className="setup-number">2</span> GitHub verbinden (optional)</h3>
      <p className="muted">
        Verknüpfe unter Projekte ein Repository, damit die KI vorhandenen Code und
        Abhängigkeiten beim Optimieren und Sortieren berücksichtigt. Das gilt auch für private Repos.
        Du wirst zu GitHub weitergeleitet und danach wieder hierher zurückgebracht.
      </p>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        GitHub verlangt dafür den Scope „repo“, der Lese- und Schreibzugriff auf private
        Repositories erlaubt. cue liest ausschließlich und speichert den Zugang verschlüsselt.
        Beim Trennen wird die Freigabe bei GitHub widerrufen. Bereits gespeicherter
        Projektkontext und der Kontext bisheriger KI-Läufe bleiben erhalten.
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {github.connected ? (
          <>
            <span>Verbunden als <b>{github.login}</b></span>
            <Button variant="tonal" icon="arrow_forward" onClick={onProjects}>Weiter: Repository auswählen</Button>
            <Button variant="outlined" icon="link_off" disabled={disconnect.isPending} onClick={() => setConfirm(true)}>
              Trennen
            </Button>
          </>
        ) : (
          <Button icon="link" onClick={() => connectGitHub()}>
            Mit GitHub verbinden
          </Button>
        )}
      </div>
      {confirm && <Confirm
        title="GitHub-Verbindung trennen?"
        confirmLabel="Trennen"
        message="cue widerruft die GitHub-Freigabe. Gespeicherter Kontext bleibt erhalten, kann aber nicht mehr aktualisiert werden."
        onCancel={() => setConfirm(false)}
        onConfirm={() => disconnect.mutate(undefined, {
          onSuccess: () => { setConfirm(false); toast.show('GitHub getrennt', 'success') },
          onError: () => toast.show('GitHub konnte nicht getrennt werden', 'error'),
        })}
      />}
    </div>
  )
}
