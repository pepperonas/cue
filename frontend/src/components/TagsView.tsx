// Central tag manager: search, usage counts, provenance, rename and delete.
//
// The view owns no tag logic — it renders `useTags()` and delegates every
// mutation to the API, which keeps the vocabulary, the assignments and the
// prompts' cached tag strings consistent server-side. Renaming onto an
// existing tag merges (the server says so via `merged`), deleting offers a
// replacement so a vocabulary clean-up never silently drops information.
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { springs } from '../lib/motion'
import type { Tag, TagSort } from '../lib/types'
import {
  useCreateTag,
  useDeleteTag,
  useRenameTag,
  useTagUsage,
  useTags,
} from '../state/queries'
import { useToast } from '../state/toast'
import { useBackDismiss } from '../state/overlays'
import { InputDialog } from './InputDialog'
import { Button, Icon } from './ui'

const SORTS: { key: TagSort; label: string }[] = [
  { key: 'usage', label: 'Verwendung' },
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Neueste' },
  { key: 'recent', label: 'Zuletzt genutzt' },
]

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { dateStyle: 'medium' })
  } catch {
    return iso
  }
}

export function TagsView() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<TagSort>('usage')
  const { data, isLoading, isFetching } = useTags({ q: query || undefined, sort })
  const createTag = useCreateTag()
  const renameTag = useRenameTag()
  const toast = useToast()

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Tag | null>(null)
  const [deleting, setDeleting] = useState<Tag | null>(null)

  const tags = data?.items ?? []
  const existing = useMemo(
    () => new Set(tags.map((t) => t.name.toLowerCase())),
    [tags],
  )
  const unused = tags.filter((t) => t.usage_count === 0).length

  return (
    <div className="tags-view">
      <header className="tags-head">
        <div className="search">
          <Icon name="search" />
          <input
            value={query}
            placeholder="Tags durchsuchen…"
            aria-label="Tags durchsuchen"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="mini-btn" aria-label="Leeren" onClick={() => setQuery('')}>
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="tags-sorts" role="tablist" aria-label="Sortierung">
          {SORTS.map((option) => (
            <button
              key={option.key}
              role="tab"
              aria-selected={sort === option.key}
              className="chip"
              data-active={sort === option.key}
              onClick={() => setSort(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button icon="add" onClick={() => setCreating(true)}>
          Tag anlegen
        </Button>
      </header>

      <p className="tags-summary">
        {data ? `${data.total} Tags` : '…'}
        {unused > 0 && ` · ${unused} ungenutzt`}
        {isFetching && !isLoading && ' · aktualisiert…'}
      </p>

      {isLoading ? (
        <div className="tag-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 56 }} />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="empty">
          <Icon name="sell" />
          <h3 style={{ margin: 0 }}>{query ? 'Nichts gefunden' : 'Noch keine Tags'}</h3>
          <p className="muted">
            {query
              ? 'Kein Tag passt zu dieser Suche.'
              : 'Tags entstehen beim Speichern eines Prompts — oder lege hier direkt einen an.'}
          </p>
        </div>
      ) : (
        <ul className="tag-list">
          <AnimatePresence initial={false}>
            {tags.map((tag, index) => (
              <motion.li
                key={tag.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ ...springs.spatial, delay: Math.min(index * 0.015, 0.2) }}
                className="tag-row"
              >
                <span className="tag-row-name">#{tag.name}</span>
                <span
                  className={`tag-row-source tag-row-source--${tag.source}`}
                  title={tag.source === 'system' ? 'Aus dem Katalog übernommen' : 'Selbst angelegt'}
                >
                  {tag.source === 'system' ? 'System' : 'Benutzer'}
                </span>
                <span className="tag-row-usage" title="Verwendungen">
                  {tag.usage_count}×
                </span>
                <time className="tag-row-date" title="Angelegt">
                  {formatDate(tag.created_at)}
                </time>
                <span className="tag-row-actions">
                  <button
                    className="mini-btn"
                    aria-label={`„${tag.name}" umbenennen`}
                    title="Umbenennen"
                    onClick={() => setRenaming(tag)}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    className="mini-btn"
                    aria-label={`„${tag.name}" löschen`}
                    title="Löschen"
                    onClick={() => setDeleting(tag)}
                  >
                    <Icon name="delete" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {creating && (
        <InputDialog
          title="Neuen Tag anlegen"
          label="Tag-Name"
          confirmLabel="Anlegen"
          initialValue=""
          validate={(value) =>
            existing.has(value.trim().toLowerCase()) ? 'Dieser Tag existiert bereits' : null
          }
          onCancel={() => setCreating(false)}
          onConfirm={(value) => {
            setCreating(false)
            createTag.mutate(value, {
              onSuccess: (tag) => toast.show(`Tag „${tag.name}" angelegt`, 'success'),
              onError: (err) =>
                toast.show(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen', 'error'),
            })
          }}
        />
      )}

      {renaming && (
        <InputDialog
          title={`„${renaming.name}" umbenennen`}
          label="Neuer Name (ein vorhandener Name führt beide zusammen)"
          confirmLabel="Umbenennen"
          initialValue={renaming.name}
          onCancel={() => setRenaming(null)}
          onConfirm={(value) => {
            const tag = renaming
            setRenaming(null)
            renameTag.mutate(
              { id: tag.id, name: value },
              {
                onSuccess: (res) =>
                  toast.show(
                    res.merged
                      ? `Mit „${res.tag.name}" zusammengeführt`
                      : `Überall in „${res.tag.name}" umbenannt`,
                    'success',
                  ),
                onError: (err) =>
                  toast.show(
                    err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen',
                    'error',
                  ),
              },
            )
          }}
        />
      )}

      {deleting && (
        <DeleteTagDialog
          tag={deleting}
          allTags={tags}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/** Delete dialog with an impact preview and an optional replacement tag. */
function DeleteTagDialog({
  tag,
  allTags,
  onClose,
}: {
  tag: Tag
  allTags: Tag[]
  onClose: () => void
}) {
  useBackDismiss(onClose)
  const { data: usage, isLoading } = useTagUsage(tag.id)
  const del = useDeleteTag()
  const toast = useToast()
  const [replaceWith, setReplaceWith] = useState<number | null>(null)
  const candidates = allTags.filter((t) => t.id !== tag.id)

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={springs.bouncy}
      >
        <h2>Tag „{tag.name}" löschen?</h2>
        {isLoading ? (
          <p className="muted" style={{ margin: 0 }}>
            Verwendung wird geprüft…
          </p>
        ) : usage && usage.prompts.length > 0 ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Der Tag wird aktuell von <b>{usage.prompts.length}</b>{' '}
              {usage.prompts.length === 1 ? 'Prompt' : 'Prompts'} verwendet. Beim Löschen wird er
              dort entfernt.
            </p>
            <ul className="tag-usage-list">
              {usage.prompts.slice(0, 5).map((p) => (
                <li key={p.id}>{p.title || 'Ohne Titel'}</li>
              ))}
              {usage.prompts.length > 5 && <li className="muted">… und {usage.prompts.length - 5} weitere</li>}
            </ul>
            {candidates.length > 0 && (
              <label className="tag-replace">
                <span className="muted">Stattdessen ersetzen durch</span>
                <select
                  className="input"
                  value={replaceWith ?? ''}
                  onChange={(e) => setReplaceWith(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— nur entfernen —</option>
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Dieser Tag wird derzeit nicht verwendet.
          </p>
        )}
        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            icon="delete"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(
                { id: tag.id, replaceWith },
                {
                  onSuccess: (res) => {
                    onClose()
                    toast.show(
                      replaceWith
                        ? `Ersetzt in ${res.prompts_updated} Prompts`
                        : res.prompts_updated
                          ? `Gelöscht und aus ${res.prompts_updated} Prompts entfernt`
                          : 'Tag gelöscht',
                      'success',
                    )
                  },
                  onError: (err) =>
                    toast.show(
                      err instanceof Error ? err.message : 'Löschen fehlgeschlagen',
                      'error',
                    ),
                },
              )
            }
          >
            {replaceWith ? 'Ersetzen' : 'Löschen'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
