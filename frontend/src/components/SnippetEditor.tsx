import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import { IS_MAC } from '../lib/platform'
import { abbreviationTaken } from '../lib/snippets'
import type { Snippet } from '../lib/types'
import { useCreateSnippet, useUpdateSnippet } from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon, IconButton } from './ui'

interface Props {
  snippet: Snippet | null // null = create
  snippets: Snippet[] // for the live duplicate check
  groups: string[]
  onClose: () => void
  onDelete?: () => void
}

export function SnippetEditor({ snippet, snippets, groups, onClose, onDelete }: Props) {
  const isEdit = !!snippet
  const create = useCreateSnippet()
  const update = useUpdateSnippet()
  const toast = useToast()

  const [abbreviation, setAbbreviation] = useState(snippet?.abbreviation ?? '')
  const [title, setTitle] = useState(snippet?.title ?? '')
  const [body, setBody] = useState(snippet?.body ?? '')
  const [groupName, setGroupName] = useState(snippet?.group_name ?? '')
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!preview) taRef.current?.focus()
  }, [preview])

  const duplicate = abbreviationTaken(snippets, abbreviation, snippet?.id ?? null)
  const canSave = !!abbreviation.trim() && !!body.trim() && !duplicate

  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.defaultPrevented) {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  async function save() {
    if (!canSave) return
    try {
      if (isEdit && snippet) {
        await update.mutateAsync({
          id: snippet.id,
          patch: {
            abbreviation: abbreviation.trim(),
            title,
            body,
            group_name: groupName, // '' ungroups (three-valued like IR)
          },
        })
        toast.show('Gespeichert', 'success')
      } else {
        await create.mutateAsync({
          abbreviation: abbreviation.trim(),
          title,
          body,
          group_name: groupName || null,
        })
        toast.show('Snippet angelegt', 'success')
      }
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Speichern fehlgeschlagen', 'error')
    }
  }

  return (
    <div className="scrim" onClick={isEdit ? undefined : onClose}>
      <motion.div
        className="sheet sheet--composer"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springs.spatial}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>
            {isEdit ? 'Snippet bearbeiten' : 'Neues Snippet'}
          </h2>
          <div className="row">
            <IconButton
              icon={preview ? 'edit' : 'visibility'}
              label={preview ? 'Bearbeiten' : 'Vorschau'}
              onClick={() => setPreview((v) => !v)}
            />
            <IconButton icon="close" label="Schließen" onClick={onClose} />
          </div>
        </div>

        <div className="composer-scroll">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="s-abbr">Abkürzung (Merge-Key in IR)</label>
              <input
                id="s-abbr"
                className={`input snippet-abbr-input ${duplicate ? 'invalid' : ''}`}
                value={abbreviation}
                placeholder="z. B. aiplan"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setAbbreviation(e.target.value)}
              />
              {duplicate && (
                <p className="error" style={{ marginTop: 4 }}>
                  Abkürzung existiert bereits
                </p>
              )}
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="s-group">Gruppe</label>
              <select
                id="s-group"
                className="select"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              >
                <option value="">— Ohne Gruppe —</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="s-title">Titel (optional)</label>
            <input
              id="s-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {preview ? (
            <div
              className="md-preview"
              title="Doppelklick zum Bearbeiten"
              style={{
                minHeight: 220,
                background: 'var(--md-surface-container-lowest)',
                borderRadius: 'var(--shape-s)',
                padding: 'var(--gap-4)',
                userSelect: 'text',
                cursor: 'text',
              }}
              onDoubleClick={() => setPreview(false)}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Nichts zum Anzeigen_') }}
            />
          ) : (
            <div className="field">
              <label htmlFor="s-body">Body</label>
              <textarea
                id="s-body"
                ref={taRef}
                className="textarea"
                value={body}
                placeholder="Der Text, den IR beim Tippen der Abkürzung einsetzt…"
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="row-end">
          {onDelete && (
            <Button variant="danger" icon="delete" onClick={onDelete}>
              Löschen
            </Button>
          )}
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="check" onClick={save} disabled={!canSave}>
            {isEdit ? 'Speichern' : 'Anlegen'}{' '}
            <kbd style={{ marginLeft: 6 }} title={IS_MAC ? 'Cmd+Enter' : 'Strg+Enter'}>
              {IS_MAC ? <Icon name="keyboard_command_key" /> : 'Strg'} ↵
            </kbd>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
