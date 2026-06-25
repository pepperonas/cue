import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from './lib/api'
import { copyText, vibrate } from './lib/clipboard'
import { springs } from './lib/motion'
import {
  BOARD_COLUMNS,
  EXTRA_COLUMNS,
  type Prompt,
  type Status,
} from './lib/types'
import {
  projectMap,
  useDeletePrompt,
  usePrompts,
  useProjects,
  useReorder,
  useUpdatePrompt,
} from './state/queries'
import { useSettings } from './state/settings'
import { useToast } from './state/toast'
import { Board } from './components/Board'
import { Composer } from './components/Composer'
import { Confirm } from './components/Confirm'
import { DetailSheet } from './components/DetailSheet'
import { ListView } from './components/ListView'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { SettingsView } from './components/SettingsView'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { TopBar, type View } from './components/TopBar'
import { Footer, Icon } from './components/ui'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .me()
      .then((m) => setAuthed(m.authenticated))
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) {
    return (
      <div className="app">
        <div className="login-wrap">
          <div className="skeleton" style={{ width: 200, height: 60 }} />
        </div>
      </div>
    )
  }
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Shell onLogout={() => setAuthed(false)} />
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const { data: prompts, isLoading } = usePrompts()
  const { data: projects } = useProjects()
  const reorder = useReorder()
  const update = useUpdatePrompt()
  const del = useDeletePrompt()

  const [view, setView] = useState<View>('board')
  const [q, setQ] = useState('')
  const [projectFilter, setProjectFilter] = useState<number | 'all' | 'none'>('all')
  const [showExtra, setShowExtra] = useState(false)

  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [detail, setDetail] = useState<Prompt | null>(null)
  const [confirmDel, setConfirmDel] = useState<Prompt | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const pmap = useMemo(() => projectMap(projects), [projects])

  const filtered = useMemo(() => {
    const list = prompts ?? []
    const query = q.trim().toLowerCase()
    return list.filter((p) => {
      if (projectFilter === 'none' && p.project_id != null) return false
      if (typeof projectFilter === 'number' && p.project_id !== projectFilter) return false
      if (query && !`${p.title} ${p.body} ${p.tags}`.toLowerCase().includes(query)) return false
      return true
    })
  }, [prompts, q, projectFilter])

  const columns = useMemo<Status[]>(
    () => (showExtra ? [...BOARD_COLUMNS, ...EXTRA_COLUMNS] : BOARD_COLUMNS),
    [showExtra],
  )

  // Ordered list used for keyboard j/k navigation (matches visible order).
  const navOrder = useMemo(() => {
    const order: Status[] = showExtra
      ? [...BOARD_COLUMNS, ...EXTRA_COLUMNS]
      : view === 'board'
        ? BOARD_COLUMNS
        : [...BOARD_COLUMNS, ...EXTRA_COLUMNS]
    return [...filtered]
      .sort(
        (a, b) =>
          order.indexOf(a.status) - order.indexOf(b.status) ||
          a.sort_order - b.sort_order ||
          a.id - b.id,
      )
      .map((p) => p.id)
  }, [filtered, showExtra, view])

  const detailLive = detail ? (prompts ?? []).find((p) => p.id === detail.id) ?? null : null

  const handleCopy = useCallback(
    async (p: Prompt) => {
      const ok = await copyText(p.body)
      if (ok) {
        vibrate(10)
        toast.show('In Zwischenablage kopiert', 'success')
        if (settings.copyAdvancesStatus && p.status === 'queued') {
          update.mutate({ id: p.id, patch: { status: 'running' } })
        }
      } else {
        toast.show('Kopieren fehlgeschlagen', 'error')
      }
    },
    [settings.copyAdvancesStatus, toast, update],
  )

  const anyModalOpen = composerOpen || !!detail || !!confirmDel || shortcuts

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const editable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (e.key === 'Escape') {
        if (shortcuts) setShortcuts(false)
        else if (confirmDel) setConfirmDel(null)
        else if (composerOpen) {
          setComposerOpen(false)
          setEditing(null)
        } else if (detail) setDetail(null)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (editable) return
      if (e.key === '?') {
        setShortcuts((v) => !v)
        return
      }
      if (anyModalOpen) {
        // Within detail, allow status keys + copy + edit.
        if (detail && detailLive) {
          if (e.key === 'c') void handleCopy(detailLive)
          if (e.key === 'e') {
            setEditing(detailLive)
            setDetail(null)
            setComposerOpen(true)
          }
          if (e.key === '1') update.mutate({ id: detailLive.id, patch: { status: 'queued' } })
          if (e.key === '2') update.mutate({ id: detailLive.id, patch: { status: 'running' } })
          if (e.key === '3') update.mutate({ id: detailLive.id, patch: { status: 'done' } })
        }
        return
      }

      if (e.key === 'n') {
        e.preventDefault()
        setEditing(null)
        setComposerOpen(true)
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        if (!navOrder.length) return
        const idx = selectedId ? navOrder.indexOf(selectedId) : -1
        const nextIdx =
          e.key === 'j'
            ? Math.min(navOrder.length - 1, idx + 1)
            : Math.max(0, idx <= 0 ? 0 : idx - 1)
        const nextId = navOrder[idx === -1 ? 0 : nextIdx]
        setSelectedId(nextId)
        document
          .querySelector(`[data-prompt-id="${nextId}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } else if (selectedId) {
        const p = (prompts ?? []).find((x) => x.id === selectedId)
        if (!p) return
        if (e.key === 'Enter') setDetail(p)
        else if (e.key === 'c') void handleCopy(p)
        else if (e.key === 'e') {
          setEditing(p)
          setComposerOpen(true)
        } else if (e.key === '1') update.mutate({ id: p.id, patch: { status: 'queued' } })
        else if (e.key === '2') update.mutate({ id: p.id, patch: { status: 'running' } })
        else if (e.key === '3') update.mutate({ id: p.id, patch: { status: 'done' } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    anyModalOpen,
    composerOpen,
    confirmDel,
    detail,
    detailLive,
    handleCopy,
    navOrder,
    prompts,
    selectedId,
    shortcuts,
    update,
  ])

  function openDetail(p: Prompt) {
    setSelectedId(p.id)
    setDetail(p)
  }

  return (
    <div className="app">
      <TopBar view={view} onView={setView} onShortcuts={() => setShortcuts(true)} />
      <main className="app-main">
        {(view === 'board' || view === 'list') && (
          <>
            <div className="row" style={{ marginBottom: 'var(--gap-4)', flexWrap: 'wrap' }}>
              <div className="search">
                <Icon name="search" />
                <input
                  ref={searchRef}
                  value={q}
                  placeholder="Prompts durchsuchen… ( / )"
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button className="mini-btn" aria-label="Leeren" onClick={() => setQ('')}>
                    <Icon name="close" />
                  </button>
                )}
              </div>
              {view === 'board' && (
                <button
                  className="chip"
                  data-active={showExtra}
                  onClick={() => setShowExtra((v) => !v)}
                >
                  <Icon name={showExtra ? 'unfold_less' : 'unfold_more'} /> Failed / Archived
                </button>
              )}
            </div>

            <div className="chips">
              <button
                className="chip"
                data-active={projectFilter === 'all'}
                onClick={() => setProjectFilter('all')}
              >
                Alle
              </button>
              <button
                className="chip"
                data-active={projectFilter === 'none'}
                onClick={() => setProjectFilter('none')}
              >
                Ohne Projekt
              </button>
              {(projects ?? []).map((p) => (
                <button
                  key={p.id}
                  className="chip"
                  data-active={projectFilter === p.id}
                  onClick={() => setProjectFilter(p.id)}
                >
                  <span className="dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="board">
                {[0, 1, 2].map((i) => (
                  <div className="skeleton" key={i} style={{ height: 220 }} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty">
                <Icon name="inbox" />
                <h3 style={{ margin: 0 }}>Keine Prompts</h3>
                <p className="muted">Lege deinen ersten Prompt an — drücke „n" oder den Button.</p>
              </div>
            ) : view === 'board' ? (
              <Board
                prompts={filtered}
                projects={pmap}
                columns={columns}
                dark={settings.resolvedDark}
                selectedId={selectedId}
                onOpen={openDetail}
                onCopy={handleCopy}
                onReorder={(items) => reorder.mutate(items)}
              />
            ) : (
              <ListView
                prompts={filtered}
                projects={pmap}
                dark={settings.resolvedDark}
                selectedId={selectedId}
                onOpen={openDetail}
                onCopy={handleCopy}
              />
            )}
          </>
        )}

        {view === 'projects' && <ProjectsView dark={settings.resolvedDark} />}
        {view === 'settings' && (
          <SettingsView
            projects={projects ?? []}
            onImported={() => setView('board')}
            onLogout={async () => {
              try {
                await api.logout()
              } catch {
                /* ignore */
              }
              onLogout()
            }}
          />
        )}
      </main>

      <Footer />

      {(view === 'board' || view === 'list') && !composerOpen && (
        <motion.button
          layoutId="composer-surface"
          className="fab"
          onClick={() => {
            setEditing(null)
            setComposerOpen(true)
          }}
          transition={springs.spatial}
          whileTap={{ scale: 0.94 }}
        >
          <Icon name="add" />
          Neuer Prompt
        </motion.button>
      )}

      <AnimatePresence>
        {composerOpen && (
          <Composer
            key="composer"
            projects={projects ?? []}
            editing={editing}
            defaultProjectId={typeof projectFilter === 'number' ? projectFilter : null}
            onClose={() => {
              setComposerOpen(false)
              setEditing(null)
            }}
          />
        )}
        {detailLive && !composerOpen && (
          <DetailSheet
            key="detail"
            prompt={detailLive}
            project={detailLive.project_id ? pmap.get(detailLive.project_id) : undefined}
            dark={settings.resolvedDark}
            onClose={() => setDetail(null)}
            onCopy={handleCopy}
            onEdit={(p) => {
              setEditing(p)
              setDetail(null)
              setComposerOpen(true)
            }}
            onDelete={(p) => setConfirmDel(p)}
            onStatus={(p, s) => update.mutate({ id: p.id, patch: { status: s } })}
          />
        )}
        {confirmDel && (
          <Confirm
            key="confirm"
            title="Prompt löschen?"
            message={`„${confirmDel.title || 'Untitled'}" wird dauerhaft entfernt.`}
            onCancel={() => setConfirmDel(null)}
            onConfirm={() => {
              del.mutate(confirmDel.id)
              setDetail(null)
              setConfirmDel(null)
              toast.show('Prompt gelöscht', 'success')
            }}
          />
        )}
        {shortcuts && <ShortcutsOverlay key="shortcuts" onClose={() => setShortcuts(false)} />}
      </AnimatePresence>
    </div>
  )
}
