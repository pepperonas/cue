import { useState } from 'react'
import { api } from '../lib/api'
import { useDisconnectGitHub, useGitHubStatus } from '../state/queries'
import { useToast } from '../state/toast'
import { Button } from './ui'
import { Confirm } from './Confirm'

export function GitHubSection() {
  const { data: github } = useGitHubStatus()
  const disconnect = useDisconnectGitHub()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  if (!github?.configured) return null

  return (
    <div className="section">
      <h3>GitHub · Projektkontext</h3>
      <p className="muted">
        Verknüpfe unter Projekte ein Repository, damit die KI vorhandenen Code und
        Abhängigkeiten beim Optimieren und Sortieren berücksichtigt. Das gilt auch für private Repos.
        KI-Läufe verwenden weiterhin deinen eigenen Anthropic-Key oder deinen freigeschalteten Runner.
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
            <Button variant="outlined" icon="link_off" disabled={disconnect.isPending} onClick={() => setConfirm(true)}>
              Trennen
            </Button>
          </>
        ) : (
          <Button icon="link" onClick={() => { window.location.href = api.githubConnectUrl }}>
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
