import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { api } from '../lib/api'
import type { CaptureSession } from '../lib/types'
import { useSendToSession, useSessions } from '../state/queries'
import { useToast } from '../state/toast'
import { Button, IconButton, Switch } from './ui'

interface Props {
  text: string
  projectId?: number | null
  onClose: () => void
}

function label(s: CaptureSession): string {
  const dir = s.cwd.replace(/\/+$/, '').split('/').pop() || s.claude_session_id.slice(0, 8)
  const when = new Date(s.last_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  return `${s.project_name ? s.project_name + ' · ' : ''}${dir} — ${when}`
}

export function SendToSessionDialog({ text, projectId, onClose }: Props) {
  const { data: sessions } = useSessions(true)
  const send = useSendToSession()
  const toast = useToast()
  const pollRef = useRef<number | null>(null)

  // Deliverable sessions, newest first; those in the prompt's project first.
  const options = useMemo(() => {
    const live = (sessions ?? []).filter((s) => s.deliverable)
    return [...live].sort((a, b) => {
      const ap = projectId != null && a.project_id === projectId ? 0 : 1
      const bp = projectId != null && b.project_id === projectId ? 0 : 1
      if (ap !== bp) return ap - bp
      return b.last_at.localeCompare(a.last_at)
    })
  }, [sessions, projectId])

  const [sessionId, setSessionId] = useState<number | null>(null)
  const [submit, setSubmit] = useState(false)
  const [busy, setBusy] = useState(false)

  // Preselect the top (most relevant) session once options load.
  useEffect(() => {
    if (sessionId == null && options.length) setSessionId(options[0].id)
  }, [options, sessionId])

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
  }, [])

  async function doSend() {
    if (sessionId == null) return
    setBusy(true)
    try {
      const { id } = await send.mutateAsync({ sessionId, text, submit })
      // Poll for the runner's result so we can report success/failure honestly.
      let ticks = 0
      pollRef.current = window.setInterval(async () => {
        ticks++
        try {
          const d = await api.getDelivery(id)
          if (d.status === 'sent') {
            window.clearInterval(pollRef.current!)
            toast.show(submit ? 'Gesendet & ausgeführt' : 'In die Session eingefügt', 'success')
            onClose()
          } else if (d.status === 'failed') {
            window.clearInterval(pollRef.current!)
            toast.show(`Senden fehlgeschlagen: ${d.error ?? 'unbekannt'}`, 'error')
            setBusy(false)
          }
        } catch {
          /* keep polling */
        }
        if (ticks > 12) {
          window.clearInterval(pollRef.current!)
          toast.show('Keine Rückmeldung vom Runner — läuft er?', 'error')
          setBusy(false)
        }
      }, 800)
    } catch {
      toast.show('Senden fehlgeschlagen', 'error')
      setBusy(false)
    }
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
          <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>An CLI-Session senden</h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        <div className="field">
          <label>Vorschau</label>
          <div className="send-preview">{text}</div>
        </div>

        <div className="field">
          <label htmlFor="send-session">Ziel-Session</label>
          {options.length === 0 ? (
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Keine erreichbare Session. Tippe einen Prompt in einer laufenden Claude-CLI (iTerm2),
              damit cue die Session kennt.
            </div>
          ) : (
            <select
              id="send-session"
              className="select"
              value={sessionId ?? ''}
              onChange={(e) => setSessionId(Number(e.target.value))}
            >
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {label(s)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div>Und ausführen</div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Drückt nach dem Einfügen Enter. Aus = du prüfst und sendest selbst ab.
            </div>
          </div>
          <Switch on={submit} onChange={setSubmit} label="Und ausführen" />
        </div>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            icon="send"
            onClick={doSend}
            disabled={busy || sessionId == null || options.length === 0}
          >
            {busy ? 'Sende…' : submit ? 'Senden & ausführen' : 'Einfügen'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
