import { useState } from 'react'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { springs } from '../lib/motion'
import { copyText } from '../lib/clipboard'
import type { CaptureSession, Project } from '../lib/types'
import {
  useDeleteSession,
  usePromoteCaptured,
  useProjects,
  useSession,
  useSessions,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon } from './ui'

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function SessionCard({
  s,
  open,
  onToggle,
}: {
  s: CaptureSession
  open: boolean
  onToggle: () => void
}) {
  const { data: detail } = useSession(open ? s.id : null)
  const promote = usePromoteCaptured()
  const del = useDeleteSession()
  const toast = useToast()

  return (
    <motion.div className="run-card" layout transition={springs.spatial}>
      <button className="run-head" onClick={onToggle} aria-expanded={open}>
        <span className="run-title grow">
          <Icon name="terminal" style={{ verticalAlign: '-4px', fontSize: 18 }} />{' '}
          {basename(s.cwd) || s.claude_session_id.slice(0, 8)}
        </span>
        <span className="tag">
          {s.prompt_count} Prompt{s.prompt_count === 1 ? '' : 's'}
        </span>
        <span className="muted run-time">{fmt(s.last_at)}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} />
      </button>

      {open && detail && (
        <div className="run-detail">
          <div className="run-meta">
            <code title={detail.cwd}>{detail.cwd}</code>
            <button
              className="chip"
              title="Session-ID kopieren"
              onClick={() => {
                void copyText(detail.claude_session_id)
                toast.show('Session-ID kopiert', 'success')
              }}
            >
              <Icon name="content_copy" /> {detail.claude_session_id.slice(0, 8)}…
            </button>
          </div>

          <div className="captured-list">
            {detail.prompts.map((cp) => (
              <div className="captured" key={cp.id}>
                <div className="captured-text">{cp.text}</div>
                <div className="captured-actions">
                  <button
                    className="mini-btn"
                    aria-label="Kopieren"
                    title="Kopieren"
                    onClick={() => {
                      void copyText(cp.text)
                      toast.show('Kopiert', 'success')
                    }}
                  >
                    <Icon name="content_copy" />
                  </button>
                  <button
                    className="mini-btn"
                    aria-label="In Queue übernehmen"
                    title="In Queue übernehmen"
                    onClick={() =>
                      promote.mutate(
                        { sessionId: s.id, cpId: cp.id },
                        { onSuccess: () => toast.show('In Queue übernommen', 'success') },
                      )
                    }
                  >
                    <Icon name="playlist_add" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="row-end">
            <Button
              variant="danger"
              icon="delete"
              onClick={() => {
                del.mutate(s.id)
                toast.show('Session gelöscht', 'success')
              }}
            >
              Session löschen
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

export function SessionsView({ dark }: { dark: boolean }) {
  const { data: sessions, isLoading } = useSessions(true)
  const { data: projects } = useProjects()
  const [openId, setOpenId] = useState<number | null>(null)

  if (!isLoading && (sessions ?? []).length === 0) {
    return (
      <div className="empty">
        <Icon name="history" />
        <h3 style={{ margin: 0 }}>Noch kein Verlauf</h3>
        <p className="muted">
          Jeder Prompt, den du in der Claude-Code-CLI eingibst, erscheint hier — gruppiert nach
          Projekt und Session.
        </p>
      </div>
    )
  }

  // Group sessions by project, in the projects' own order (then "Ohne Projekt").
  const list = sessions ?? []
  const groups: { key: string; name: string; project?: Project; items: CaptureSession[] }[] = []
  const index = new Map<string, number>()
  const projectOrder = (projects ?? []).map((p) => p.id)
  for (const s of list) {
    const key = s.project_id == null ? 'none' : String(s.project_id)
    if (!index.has(key)) {
      index.set(key, groups.length)
      groups.push({
        key,
        name: s.project_name ?? 'Ohne Projekt',
        project: (projects ?? []).find((p) => p.id === s.project_id),
        items: [],
      })
    }
    groups[index.get(key) as number].items.push(s)
  }
  groups.sort((a, b) => {
    const ai = a.project ? projectOrder.indexOf(a.project.id) : Infinity
    const bi = b.project ? projectOrder.indexOf(b.project.id) : Infinity
    return ai - bi
  })

  return (
    <div className="sessions">
      {groups.map((g) => {
        const tones = g.project ? projectTones(g.project.color, dark) : null
        return (
          <section className="session-group" key={g.key}>
            <h3 className="session-group-head">
              {tones && (
                <span
                  className="dot"
                  style={{ background: tones.accent, width: 12, height: 12, borderRadius: '50%' }}
                />
              )}
              {g.name}
              <span className="count">{g.items.length}</span>
            </h3>
            <div className="runs-list">
              {g.items.map((s) => (
                <SessionCard
                  key={s.id}
                  s={s}
                  open={openId === s.id}
                  onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
