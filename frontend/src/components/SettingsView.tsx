import { useRef, useState } from 'react'
import { api } from '../lib/api'
import { PRESET_SEEDS } from '../lib/color'
import type { Project } from '../lib/types'
import { useSettings } from '../state/settings'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton, Switch } from './ui'

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

  const [split, setSplit] = useState('rule')
  const [importProject, setImportProject] = useState<number | null>(null)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwHash, setPwHash] = useState('')

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

  async function changePassword() {
    if (newPw.length < 8) {
      toast.show('Neues Passwort zu kurz (min. 8)', 'error')
      return
    }
    try {
      const res = await api.changePassword(curPw, newPw)
      setPwHash(res.new_password_hash)
      setCurPw('')
      setNewPw('')
      toast.show('Hash erzeugt — in .env eintragen', 'success')
    } catch {
      toast.show('Aktuelles Passwort falsch', 'error')
    }
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
              onClick={() => s.setTheme(t.key)}
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
        <h3>Passwort ändern</h3>
        <div className="field">
          <label>Aktuelles Passwort</label>
          <input
            className="input"
            type="password"
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Neues Passwort</label>
          <input
            className="input"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
        </div>
        <Button variant="tonal" icon="key" onClick={changePassword} disabled={!curPw || !newPw}>
          Hash erzeugen
        </Button>
        {pwHash && (
          <div className="field">
            <label>Neuen Hash in .env eintragen und Container neu starten:</label>
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
                APP_PASSWORD_HASH={pwHash}
              </code>
              <IconButton
                icon="content_copy"
                label="Kopieren"
                onClick={() => {
                  navigator.clipboard?.writeText(`APP_PASSWORD_HASH=${pwHash}`)
                  toast.show('Kopiert', 'success')
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="section">
        <h3>Sitzung</h3>
        <Button variant="outlined" icon="logout" onClick={onLogout}>
          Abmelden
        </Button>
      </div>
    </div>
  )
}
