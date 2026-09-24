import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import { formatAge, parseTimestamp } from '../lib/relative-time'
import type { Device } from '../lib/types'
import { useCreateDevice, useDevices, useRevokeDevice } from '../state/queries'
import { useToast } from '../state/toast'
import { Confirm } from './Confirm'
import { InputDialog } from './InputDialog'
import { Button } from './ui'

/**
 * Geräte, die per eigenem Token auf die Prompts zugreifen (Android-App).
 *
 * Der Token erscheint genau einmal, direkt nach dem Anlegen. Danach existiert
 * er nur noch als Hash auf dem Server — wer ihn verliert, legt ein neues Gerät
 * an und sperrt das alte.
 */

// `RelativeTime` ist an Prompts gebunden (created_at/edited_at); hier genügt
// eine einmal gerechnete, nicht tickende Angabe — die Liste lädt bei jedem
// Öffnen der Einstellungen neu.
function age(iso: string): string {
  const stamp = parseTimestamp(iso)
  return stamp === null ? '' : formatAge(stamp, Date.now())
}

export function DevicesSection() {
  const { data: devices = [] } = useDevices()
  const create = useCreateDevice()
  const revoke = useRevokeDevice()
  const toast = useToast()
  const [naming, setNaming] = useState(false)
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)
  const [toRevoke, setToRevoke] = useState<Device | null>(null)

  return (
    <div className="section">
      <h3>Geräte</h3>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
        Ein Gerät darf Prompts lesen, anlegen und bearbeiten — keine Runs, keine CLI, keine
        Optimierung. Sperren wirkt bei der nächsten Anfrage.
      </p>

      {devices.length === 0 && <p className="muted">Noch kein Gerät.</p>}
      {devices.map((d) => (
        <div key={d.id} className="admin-user-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: 'var(--title-s)' }}>{d.name}</div>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {d.revoked_at
                ? `gesperrt ${age(d.revoked_at)}`
                : d.last_seen_at
                  ? `zuletzt ${age(d.last_seen_at)}`
                  : 'noch nie verbunden'}
            </div>
          </div>
          {!d.revoked_at && (
            <Button variant="outlined" icon="block" onClick={() => setToRevoke(d)}>
              Sperren
            </Button>
          )}
        </div>
      ))}

      <Button variant="tonal" icon="add" onClick={() => setNaming(true)}>
        Gerät hinzufügen
      </Button>

      {fresh && (
        <div className="field">
          <label style={{ color: 'var(--danger)' }}>
            ⚠️ Nur jetzt sichtbar — in der App unter Einstellungen einfügen:
          </label>
          <div className="row">
            <code
              style={{
                flex: 1,
                overflow: 'auto',
                overflowWrap: 'anywhere',
                background: 'var(--md-surface-container-lowest)',
                padding: '8px 12px',
                borderRadius: 'var(--shape-s)',
                fontSize: '0.75rem',
              }}
            >
              {fresh.token}
            </code>
            <Button
              variant="filled"
              icon="content_copy"
              onClick={async () => {
                if (await copyText(fresh.token)) toast.show('Token kopiert', 'success')
              }}
            >
              Kopieren
            </Button>
          </div>
          <Button variant="text" onClick={() => setFresh(null)}>
            Fertig
          </Button>
        </div>
      )}

      {naming && (
        <InputDialog
          title="Gerät hinzufügen"
          label="Name"
          placeholder="Pixel 8"
          confirmLabel="Anlegen"
          onCancel={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false)
            create.mutate(name.trim(), {
              onSuccess: (d) => setFresh({ name: d.name, token: d.token }),
              onError: () => toast.show('Gerät konnte nicht angelegt werden', 'error'),
            })
          }}
        />
      )}

      {toRevoke && (
        <Confirm
          title={`„${toRevoke.name}" sperren?`}
          message="Das Gerät verliert sofort den Zugriff und löscht beim nächsten Abgleich seine lokale Kopie."
          confirmLabel="Sperren"
          onCancel={() => setToRevoke(null)}
          onConfirm={() => {
            revoke.mutate(toRevoke.id)
            setToRevoke(null)
          }}
        />
      )}
    </div>
  )
}
