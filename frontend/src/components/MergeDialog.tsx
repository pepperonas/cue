import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import type { Project, Prompt, Status } from '../lib/types'
import { STATUS_LABEL, STATUSES } from '../lib/types'
import { Button, Icon, IconButton } from './ui'

type Format = 'headings' | 'rule' | 'blank'
type Originals = 'delete' | 'archive' | 'keep'

interface Props {
  parts: Prompt[]
  projects: Project[]
  onClose: () => void
  onConfirm: (payload: {
    source_ids: number[]
    title: string
    body: string
    project_id: number | null
    status: Status
    tags: string
    originals: Originals
  }) => void
}

const FORMATS: { key: Format; label: string }[] = [
  { key: 'headings', label: 'Titel als Überschrift' },
  { key: 'rule', label: 'Nur Trennlinie ---' },
  { key: 'blank', label: 'Nur Leerzeile' },
]

const ORIGINALS: { key: Originals; icon: string; label: string }[] = [
  { key: 'delete', icon: 'delete', label: 'Löschen' },
  { key: 'archive', icon: 'inventory_2', label: 'Archivieren' },
  { key: 'keep', icon: 'content_copy', label: 'Behalten' },
]

function buildBody(parts: Prompt[], format: Format): string {
  const bodies = parts.map((p) => p.body.trim())
  if (format === 'blank') return bodies.join('\n\n')
  if (format === 'rule') return bodies.join('\n\n---\n\n')
  return parts.map((p) => `## ${p.title || 'Untitled'}\n\n${p.body.trim()}`).join('\n\n---\n\n')
}

export function MergeDialog({ parts, projects, onClose, onConfirm }: Props) {
  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])

  // Smart prefills: common project (or none), union of tags.
  const commonProject = useMemo(() => {
    const ids = new Set(parts.map((p) => p.project_id ?? 0))
    const only = parts[0]?.project_id ?? null
    return ids.size === 1 && only != null ? only : null
  }, [parts])
  const unionTags = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of parts) {
      for (const t of (p.tags ?? '').split(',')) {
        const k = t.trim()
        if (k && !seen.has(k.toLowerCase())) {
          seen.add(k.toLowerCase())
          out.push(k)
        }
      }
    }
    return out.join(', ')
  }, [parts])

  const [order, setOrder] = useState<number[]>(parts.map((p) => p.id))
  const [format, setFormat] = useState<Format>('headings')
  // Default title = source titles joined "A [&] B"; follows reorder until edited.
  const [title, setTitle] = useState(() =>
    parts.map((p) => p.title || 'Untitled').join(' [&] '),
  )
  const [titleTouched, setTitleTouched] = useState(false)
  const [projectId, setProjectId] = useState<number | null>(commonProject)
  const [status, setStatus] = useState<Status>('queued')
  const [tags, setTags] = useState(unionTags)
  const [originals, setOriginals] = useState<Originals>('delete')

  const orderedParts = order.map((id) => byId.get(id)).filter(Boolean) as Prompt[]
  const body = useMemo(() => buildBody(orderedParts, format), [orderedParts, format])

  const autoTitle = orderedParts.map((p) => p.title || 'Untitled').join(' [&] ')
  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle)
  }, [autoTitle, titleTouched])

  function move(idx: number, dir: -1 | 1) {
    const next = [...order]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setOrder(next)
  }
  function remove(id: number) {
    if (order.length <= 2) return
    setOrder(order.filter((x) => x !== id))
  }

  function confirm() {
    onConfirm({
      source_ids: order,
      title,
      body,
      project_id: projectId,
      status,
      tags,
      originals,
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
            {order.length} Prompts zusammenführen
          </h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        {/* Reorderable source list */}
        <div className="field">
          <label>Reihenfolge</label>
          <div className="merge-parts">
            {orderedParts.map((p, i) => (
              <div className="merge-part" key={p.id}>
                <span className="merge-index">{i + 1}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="lt">{p.title || 'Untitled'}</div>
                  <div className="muted merge-part-preview">{p.body}</div>
                </div>
                <button
                  className="mini-btn"
                  aria-label="Nach oben"
                  title="Nach oben"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="keyboard_arrow_up" />
                </button>
                <button
                  className="mini-btn"
                  aria-label="Nach unten"
                  title="Nach unten"
                  disabled={i === orderedParts.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="keyboard_arrow_down" />
                </button>
                <button
                  className="mini-btn"
                  aria-label="Entfernen"
                  title="Aus Merge entfernen"
                  disabled={order.length <= 2}
                  onClick={() => remove(p.id)}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="field">
          <label>Format</label>
          <div className="row" style={{ gap: 'var(--gap-2)', flexWrap: 'wrap' }}>
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className="chip"
                data-active={format === f.key}
                onClick={() => setFormat(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview */}
        <div className="field">
          <label>Vorschau</label>
          <div
            className="md-preview"
            style={{
              background: 'var(--md-surface-container-lowest)',
              borderRadius: 'var(--shape-s)',
              padding: 'var(--gap-4)',
              maxHeight: 260,
              overflow: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Leer_') }}
          />
        </div>

        <div className="field">
          <label htmlFor="m-title">Titel (optional)</label>
          <input
            id="m-title"
            className="input"
            value={title}
            placeholder="Aus erster Zeile abgeleitet, wenn leer"
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
          />
        </div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="m-project">Projekt</label>
            <select
              id="m-project"
              className="select"
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Kein Projekt —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="m-status">Status</label>
            <select
              id="m-status"
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="m-tags">Tags</label>
          <input
            id="m-tags"
            className="input"
            value={tags}
            placeholder="kommagetrennt"
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        {/* Originals handling */}
        <div className="field">
          <label>Mit den Originalen</label>
          <div className="row" style={{ gap: 'var(--gap-2)', flexWrap: 'wrap' }}>
            {ORIGINALS.map((o) => (
              <button
                key={o.key}
                className="chip"
                data-active={originals === o.key}
                onClick={() => setOriginals(o.key)}
              >
                <Icon name={o.icon} /> {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="merge" onClick={confirm} disabled={order.length < 2 || !body.trim()}>
            Zusammenführen
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
