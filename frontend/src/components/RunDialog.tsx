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

// Last-used run settings, restored when the dialog opens so the permission
// setup doesn't have to be re-entered for every run. The subfolder is
// deliberately NOT remembered (it changes per run).
const RUN_PREFS_KEY = 'cue-run-prefs'

interface RunPrefs {
  base?: string
  model?: string
  permission_mode?: string
  allowed_tools?: string
  bare?: boolean
  skip_permissions?: boolean
  stop_on_error?: boolean
}

function loadPrefs(): RunPrefs {
  try {
    const raw = localStorage.getItem(RUN_PREFS_KEY)
    const p = raw ? JSON.parse(raw) : null
    return p && typeof p === 'object' ? (p as RunPrefs) : {}
  } catch {
    return {}
  }
}

export function RunDialog({ kind, prompts, config, busy, onClose, onSubmit }: Props) {
  const byId = new Map(prompts.map((p) => [p.id, p]))
  // Steps default to the board order of the Queued column (top to bottom),
  // regardless of the click order during selection. ↑/↓ still allow overrides.
  const [order, setOrder] = useState<number[]>(() =>
    [...prompts]
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((p) => p.id),
  )
  // Restore the last-used settings; anything no longer valid against the
  // server-provided whitelists falls back to the previous defaults.
  const prefs = loadPrefs()
  const [base, setBase] = useState(() =>
    prefs.base && config.allowed_bases.includes(prefs.base)
      ? prefs.base
      : config.allowed_bases[0] ?? '',
  )
  const [subpath, setSubpath] = useState('')
  const [model, setModel] = useState(() =>
    prefs.model && config.models.includes(prefs.model) ? prefs.model : '',
  )
  const [permissionMode, setPermissionMode] = useState(() =>
    prefs.permission_mode && config.permission_modes.includes(prefs.permission_mode)
      ? prefs.permission_mode
      : 'acceptEdits',
  )
  const [allowedTools, setAllowedTools] = useState(
    typeof prefs.allowed_tools === 'string' ? prefs.allowed_tools : 'Read,Edit,Bash',
  )
  const [bare, setBare] = useState(prefs.bare === true)
  const [skipPermissions, setSkipPermissions] = useState(prefs.skip_permissions === true)
  const [stopOnError, setStopOnError] = useState(prefs.stop_on_error !== false)

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
    const nextPrefs: RunPrefs = {
      base,
      model,
      permission_mode: permissionMode,
      allowed_tools: allowedTools,
      bare,
      skip_permissions: skipPermissions,
      stop_on_error: stopOnError,
    }
    try {
      localStorage.setItem(RUN_PREFS_KEY, JSON.stringify(nextPrefs))
    } catch {
      /* quota/private mode — running still works, just no memory */
    }
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
