import { useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import type { Prompt, RunConfig, RunKind } from '../lib/types'
import { Button, Icon, IconButton, Switch } from './ui'

export interface RunPayload {
  kind: RunKind
  prompt_ids: number[]
  project_path: string
  model: string | null
  allowed_tools: string | null
  permission_mode: string | null
  bare: boolean
  skip_permissions: boolean
  stop_on_error: boolean
}

interface Props {
  kind: RunKind
  prompts: Prompt[]
  config: RunConfig
  busy?: boolean
  onClose: () => void
  onSubmit: (payload: RunPayload) => void
}

export function RunDialog({ kind, prompts, config, busy, onClose, onSubmit }: Props) {
  const byId = new Map(prompts.map((p) => [p.id, p]))
  const [order, setOrder] = useState<number[]>(prompts.map((p) => p.id))
  const [base, setBase] = useState(config.allowed_bases[0] ?? '')
  const [subpath, setSubpath] = useState('')
  const [model, setModel] = useState('')
  const [permissionMode, setPermissionMode] = useState('acceptEdits')
  const [allowedTools, setAllowedTools] = useState('Read,Edit,Bash')
  const [bare, setBare] = useState(false)
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [stopOnError, setStopOnError] = useState(true)

  const cleanSub = subpath.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const projectPath = base ? (cleanSub ? `${base}/${cleanSub}` : base) : ''

  function move(idx: number, dir: -1 | 1) {
    const next = [...order]
    const t = idx + dir
    if (t < 0 || t >= next.length) return
    ;[next[idx], next[t]] = [next[t], next[idx]]
    setOrder(next)
  }

  function submit() {
    onSubmit({
      kind,
      prompt_ids: order,
      project_path: projectPath,
      model: model || null,
      allowed_tools: allowedTools.trim() || null,
      permission_mode: permissionMode || null,
      bare,
      skip_permissions: skipPermissions,
      stop_on_error: stopOnError,
    })
  }

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springs.spatial}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>
            {kind === 'chain' ? `Playbook ausführen (${order.length})` : 'Prompt ausführen'}
          </h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        {/* Prompt(s) */}
        <div className="field">
          <label>{kind === 'chain' ? 'Schritte (Reihenfolge)' : 'Prompt'}</label>
          <div className="merge-parts">
            {order.map((id, i) => {
              const p = byId.get(id)
              if (!p) return null
              return (
                <div className="merge-part" key={id}>
                  <span className="merge-index">{i + 1}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="lt">{p.title || 'Untitled'}</div>
                  </div>
                  {kind === 'chain' && (
                    <>
                      <button className="mini-btn" aria-label="Hoch" disabled={i === 0} onClick={() => move(i, -1)}>
                        <Icon name="keyboard_arrow_up" />
                      </button>
                      <button
                        className="mini-btn"
                        aria-label="Runter"
                        disabled={i === order.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <Icon name="keyboard_arrow_down" />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Project path */}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="r-base">Projekt-Basis</label>
            <select id="r-base" className="select" value={base} onChange={(e) => setBase(e.target.value)}>
              {config.allowed_bases.length === 0 && <option value="">— keine konfiguriert —</option>}
              {config.allowed_bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="r-sub">Unterordner (optional)</label>
            <input
              id="r-sub"
              className="input"
              value={subpath}
              placeholder="z. B. cue"
              onChange={(e) => setSubpath(e.target.value)}
            />
          </div>
        </div>
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: -8 }}>
          Pfad: <code>{projectPath || '—'}</code>
        </div>

        {/* Options */}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="r-model">Modell</label>
            <select id="r-model" className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Standard</option>
              {config.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="r-perm">Permission-Mode</label>
            <select
              id="r-perm"
              className="select"
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
            >
              {config.permission_modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="r-tools">Erlaubte Tools (kommagetrennt)</label>
          <input
            id="r-tools"
            className="input"
            value={allowedTools}
            placeholder="Read,Edit,Bash"
            onChange={(e) => setAllowedTools(e.target.value)}
          />
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Bei Fehler stoppen</span>
          <Switch on={stopOnError} onChange={setStopOnError} label="Bei Fehler stoppen" />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div>Bare-Modus</div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Überspringt Hooks/Skills/CLAUDE.md (reproduzierbarer).
            </div>
          </div>
          <Switch on={bare} onChange={setBare} label="Bare" />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'var(--md-error)' }}>Alle Permissions überspringen</div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              ⚠️ Führt Tools ohne jede Rückfrage aus. Nur für vertrauenswürdige Prompts.
            </div>
          </div>
          <Switch on={skipPermissions} onChange={setSkipPermissions} label="Skip permissions" />
        </div>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="play_arrow" onClick={submit} disabled={busy || !projectPath || order.length === 0}>
            {busy ? 'Starte…' : 'Ausführen'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
