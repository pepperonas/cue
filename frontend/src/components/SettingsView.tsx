import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { PRESET_SEEDS } from '../lib/color'
import type { Project } from '../lib/types'
import { useAdminUsers, useCaptureSettings, useMe, useSetUserApproval, useSyncSettings, useUpdateCaptureSettings, useUpdateSyncSettings } from '../state/queries'
import { useSettings } from '../state/settings'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton, Switch } from './ui'
import { Confirm } from './Confirm'

const THEMES: { key: 'light' | 'dark' | 'system'; icon: string; label: string }[] = [
  { key: 'light', icon: 'light_mode', label: 'Hell' },
  { key: 'dark', icon: 'dark_mode', label: 'Dunkel' },
  { key: 'system', icon: 'brightness_auto', label: 'System' },
]

export function SettingsView({
  projects,
  onImported,
  onLogout,
}: {
  projects: Project[]
  onImported: () => void
  onLogout: () => void
}) {
  const s = useSettings()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: me } = useMe()

  const [split, setSplit] = useState('rule')
  const [importProject, setImportProject] = useState<number | null>(null)

  const { data: capture } = useCaptureSettings()
  const updateCapture = useUpdateCaptureSettings()
  const [captureBase, setCaptureBase] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  useEffect(() => {
    if (capture) setCaptureBase(capture.project_base)
  }, [capture?.project_base])

  const { data: syncSettings } = useSyncSettings()
  const updateSync = useUpdateSyncSettings()
  const [newSyncToken, setNewSyncToken] = useState<string | null>(null)

  async function doImport(files: FileList | null) {
    if (!files || !files.length) return
    try {
      const created = await api.importTxt(Array.from(files), split, importProject)
      toast.show(`${created.length} Prompt(s) importiert`, 'success')
      onImported()
    } catch {
      toast.show('Import fehlgeschlagen', 'error')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <div className="section">
        <h3>Erscheinungsbild</h3>
        <div className="row" style={{ gap: 'var(--gap-2)' }}>
          {THEMES.map((t) => (
            <button
              key={t.key}
              className="chip"
              data-active={s.theme === t.key}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                s.setTheme(t.key, {
                  x: e.clientX || r.left + r.width / 2,
                  y: e.clientY || r.top + r.height / 2,
                })
              }}
            >
              <Icon name={t.icon} /> {t.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label>Akzentfarbe (Material You Seed)</label>
          <div className="swatches">
            {PRESET_SEEDS.map((seed) => (
              <button
                key={seed}
                className="swatch"
                data-active={s.seed.toLowerCase() === seed.toLowerCase()}
                style={{ background: seed }}
                aria-label={seed}
                onClick={() => s.setSeed(seed)}
              />
            ))}
            <label className="swatch" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <Icon name="palette" />
              <input
                type="color"
                value={s.seed}
                onChange={(e) => s.setSeed(e.target.value)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Verhalten</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div>Kopieren setzt Status auf „Running"</div>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Beim Kopieren eines Prompts automatisch von Queued → Running.
            </div>
          </div>
          <Switch
            on={s.copyAdvancesStatus}
            onChange={s.setCopyAdvancesStatus}
            label="Kopieren setzt Status"
          />
        </div>
      </div>

      <div className="section">
        <h3>Import / Export</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Split-Modus</label>
            <select className="select" value={split} onChange={(e) => setSplit(e.target.value)}>
              <option value="none">Eine Datei = ein Prompt</option>
              <option value="rule">Trennen an „---"</option>
              <option value="blank">Trennen an Leerzeilen</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Ziel-Projekt</label>
            <select
              className="select"
              value={importProject ?? ''}
              onChange={(e) => setImportProject(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Kein Projekt —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => doImport(e.target.files)}
        />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button variant="tonal" icon="upload_file" onClick={() => fileRef.current?.click()}>
            .txt importieren
          </Button>
          <Button variant="outlined" icon="download" onClick={() => window.open(api.exportJsonUrl)}>
            JSON-Backup
          </Button>
          <Button variant="outlined" icon="folder_zip" onClick={() => window.open(api.exportZipUrl)}>
            ZIP (.txt)
          </Button>
        </div>
      </div>

      <div className="section">
        <h3>Prompt-Capture</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
          Jeder Prompt, den du in der Claude-Code-CLI eingibst, wird in cue protokolliert
          (Ansicht „Verlauf"). Der Runner auf deinem Rechner leitet ihn weiter.
        </p>
        <div className="field">
          <label htmlFor="cap-base">Projekt-Basis (für die Projekt-Zuordnung)</label>
          <div className="row">
            <input
              id="cap-base"
              className="input grow"
              value={captureBase}
              placeholder="/Users/deinname/projekte"
              onChange={(e) => setCaptureBase(e.target.value)}
            />
            <Button
              variant="tonal"
              icon="save"
              onClick={() =>
                updateCapture.mutate(
                  { project_base: captureBase },
                  { onSuccess: () => toast.show('Basis-Pfad gespeichert', 'success') },
                )
              }
            >
              Speichern
            </Button>
          </div>
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            Der erste Ordner unterhalb dieses Pfads wird zum Projektnamen.
          </div>
        </div>

        <div className="field">
          <label>Capture-Token</label>
          <div className="row">
            <span className="muted" style={{ flex: 1 }}>
              {capture?.has_token ? 'Token gesetzt.' : 'Noch kein Token.'} Für den Runner
              (`CAPTURE_TOKEN`).
            </span>
            <Button
              variant="outlined"
              icon="key"
              onClick={() =>
                updateCapture.mutate(
                  { regenerate: true },
                  {
                    onSuccess: (d) => {
                      setNewToken(d.token ?? null)
                      toast.show('Neues Token erzeugt', 'success')
                    },
                  },
                )
              }
            >
              {capture?.has_token ? 'Neu generieren' : 'Token generieren'}
            </Button>
          </div>
          {newToken && (
            <div className="field">
              <label style={{ color: 'var(--md-error)' }}>
                ⚠️ Nur jetzt sichtbar — in die Runner-`.env` als CAPTURE_TOKEN eintragen:
              </label>
              <div className="row">
                <code
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    background: 'var(--md-surface-container-lowest)',
                    padding: '8px 12px',
                    borderRadius: 'var(--shape-s)',
                    fontSize: '0.75rem',
                  }}
                >
                  {newToken}
                </code>
                <IconButton
                  icon="content_copy"
                  label="Kopieren"
                  onClick={() => {
                    navigator.clipboard?.writeText(newToken)
                    toast.show('Kopiert', 'success')
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <h3>Snippet-Sync (Inspector Rust)</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
          Synchronisiert Snippets automatisch mit Inspector Rust — in beide Richtungen.
          Welche Gruppen mitmachen, schaltest du direkt im Snippets-Tab am ☁️-Symbol im
          Gruppen-Header um. Löschungen werden mitgeführt; bei gleichzeitiger Bearbeitung
          gewinnt die höhere Version (bei Gleichstand cue).
        </p>
        <div className="field">
          <label>Sync-Token</label>
          <div className="row">
            <span className="muted" style={{ flex: 1 }}>
              {syncSettings?.has_token ? 'Token gesetzt.' : 'Noch kein Token.'} In Inspector
              Rust unter {'„Settings → Cloud-Sync (cue)"'} eintragen.
            </span>
            <Button
              variant="outlined"
              icon="key"
              onClick={() =>
                updateSync.mutate(
                  { regenerate: true },
                  {
                    onSuccess: (d) => {
                      setNewSyncToken(d.token ?? null)
                      toast.show('Neues Sync-Token erzeugt', 'success')
                    },
                  },
                )
              }
            >
              {syncSettings?.has_token ? 'Neu generieren' : 'Token generieren'}
            </Button>
          </div>
          {newSyncToken && (
            <div className="field">
              <label style={{ color: 'var(--md-error)' }}>
                ⚠️ Nur jetzt sichtbar — in Inspector Rust einfügen:
              </label>
              <div className="row">
                <code
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    background: 'var(--md-surface-container-lowest)',
                    padding: '8px 12px',
                    borderRadius: 'var(--shape-s)',
                    fontSize: '0.75rem',
                  }}
                >
                  {newSyncToken}
                </code>
                <IconButton
                  icon="content_copy"
                  label="Kopieren"
                  onClick={() => {
                    navigator.clipboard?.writeText(newSyncToken)
                    toast.show('Kopiert', 'success')
                  }}
                />
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {syncSettings?.last_sync
              ? `Zuletzt synchronisiert: ${new Date(syncSettings.last_sync).toLocaleString()}`
              : 'Noch nie synchronisiert.'}
          </div>
        </div>
      </div>

      {me?.is_admin && <AdminUsersSection />}

      <div className="section">
        <h3>Konto</h3>
        {me?.user ? (
          <div className="row" style={{ gap: 'var(--gap-3)', alignItems: 'center' }}>
            {me.user.picture ? (
              <img
                src={me.user.picture}
                alt=""
                width={44}
                height={44}
                referrerPolicy="no-referrer"
                style={{ borderRadius: '50%' }}
              />
            ) : (
              <span className="logo" style={{ width: 44, height: 44 }}>
                <Icon name="account_circle" />
              </span>
            )}
            <div className="grow" style={{ minWidth: 0 }}>
              {me.user.name && <div style={{ font: 'var(--title-s)' }}>{me.user.name}</div>}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {me.user.email}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">Angemeldet.</p>
        )}
        <Button variant="outlined" icon="logout" onClick={onLogout}>
          Abmelden
        </Button>
      </div>
    </div>
  )
}


/** Owner-only: approve/revoke user accounts (sign-in is open, data access
 * requires approval — the gate sits in the backend's current_user_id). */
function AdminUsersSection() {
  const { data: users } = useAdminUsers(true)
  const setApproval = useSetUserApproval()
  const toast = useToast()
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: number; email: string } | null>(null)

  const pending = (users ?? []).filter((u) => !u.approved)
  const approved = (users ?? []).filter((u) => u.approved)

  function approve(id: number, email: string) {
    setApproval.mutate(
      { id, approved: true },
      {
        onSuccess: () => toast.show(`${email} freigeschaltet`, 'success'),
        onError: (e) => toast.show(e instanceof Error ? e.message : 'Fehlgeschlagen', 'error'),
      },
    )
  }

  return (
    <div className="section">
      <h3>Nutzerverwaltung</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Neue Nutzer melden sich mit Google an und warten dann auf Freischaltung. Sperren
        entzieht den Zugriff sofort — die Daten des Kontos bleiben erhalten.
      </p>
      {pending.length > 0 && (
        <>
          <h4 className="admin-subhead">
            Wartet auf Freischaltung <span className="count">{pending.length}</span>
          </h4>
          {pending.map((u) => (
            <AdminUserRow key={u.id} user={u}>
              <Button icon="check" onClick={() => approve(u.id, u.email)}>
                Freischalten
              </Button>
            </AdminUserRow>
          ))}
        </>
      )}
      <h4 className="admin-subhead">
        Freigeschaltet <span className="count">{approved.length}</span>
      </h4>
      {approved.map((u) => (
        <AdminUserRow key={u.id} user={u}>
          <Button
            variant="outlined"
            icon="block"
            onClick={() => setConfirmRevoke({ id: u.id, email: u.email })}
          >
            Sperren
          </Button>
        </AdminUserRow>
      ))}
      {confirmRevoke && (
        <Confirm
          title={`${confirmRevoke.email} sperren?`}
          message="Der Zugriff endet mit dem nächsten Request. Die Daten des Kontos bleiben erhalten; eine erneute Freischaltung ist jederzeit möglich."
          confirmLabel="Sperren"
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => {
            setApproval.mutate(
              { id: confirmRevoke.id, approved: false },
              {
                onSuccess: () => toast.show(`${confirmRevoke.email} gesperrt`, 'success'),
                onError: (e) =>
                  toast.show(e instanceof Error ? e.message : 'Fehlgeschlagen', 'error'),
              },
            )
            setConfirmRevoke(null)
          }}
        />
      )}
    </div>
  )
}

function AdminUserRow({
  user,
  children,
}: {
  user: import('../lib/types').AdminUser
  children: React.ReactNode
}) {
  return (
    <div className="admin-user-row">
      {user.picture ? (
        <img src={user.picture} alt="" width={36} height={36} referrerPolicy="no-referrer"
          style={{ borderRadius: '50%' }} />
      ) : (
        <span className="logo" style={{ width: 36, height: 36 }}>
          <Icon name="account_circle" />
        </span>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ font: 'var(--title-s)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user.name || user.email}
        </div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {user.email} · seit {new Date(user.created_at).toLocaleDateString('de-DE')}
        </div>
      </div>
      {children}
    </div>
  )
}
