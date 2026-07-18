import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from './lib/api'
import { copyText, vibrate } from './lib/clipboard'
import { springs } from './lib/motion'
import { columnComparator } from './lib/order'
import {
  BOARD_COLUMNS,
  EXTRA_COLUMNS,
  type Me,
  type Prompt,
  type RunKind,
  type Status,
} from './lib/types'
import {
  projectMap,
  useCreateRun,
  useDeletePrompt,
  useDuplicateInPlace,
  useDuplicatePrompt,
  useMergePrompts,
  usePrompts,
  useProjects,
  useReorder,
  useReorderBookmarks,
  useRunConfig,
  useUpdatePrompt,
} from './state/queries'
import { useSettings } from './state/settings'
import { useToast } from './state/toast'
import { Board } from './components/Board'
import { BookmarksView } from './components/BookmarksView'
import { Composer } from './components/Composer'
import { MergeDialog } from './components/MergeDialog'
import { RunDialog, type RunPayload } from './components/RunDialog'
import { SendToSessionDialog } from './components/SendToSessionDialog'
import { RunsView } from './components/RunsView'
import { RunTicker } from './components/RunTicker'
import { SessionsView } from './components/SessionsView'
import { SnippetsView } from './components/SnippetsView'
import { DetailSheet } from './components/DetailSheet'
import { ListView } from './components/ListView'
import { Login } from './components/Login'
import { ProjectChips } from './components/ProjectChips'
import { ProjectsView } from './components/ProjectsView'
import { SettingsView } from './components/SettingsView'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { TopBar, type View } from './components/TopBar'
import { Footer, Icon } from './components/ui'

export default function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading')

  useEffect(() => {
    api
      .me()
      .then((m) => setMe(m))
      .catch(() => setMe(null))
  }, [])

  if (me === 'loading') {
    return (
      <div className="app">
        <div className="login-wrap">
          <div className="skeleton" style={{ width: 200, height: 60 }} />
        </div>
      </div>
    )
  }
  if (!me || !me.authenticated) return <Login />
  if (!me.approved) return <PendingApproval onLogout={() => setMe(null)} />
  return <Shell onLogout={() => setMe(null)} />
}

/** Signed in with Google, but the admin hasn't approved the account yet. */
function PendingApproval({ onLogout }: { onLogout: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="app">
      <div className="login-wrap">
        <motion.div
          className="login-card"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.bouncy}
        >
          <div className="logo-xl">
            <Icon name="hourglass_top" />
          </div>
          <div>
            <h1 style={{ font: 'var(--headline-l)', margin: 0 }}>Fast geschafft</h1>
            <p className="muted" style={{ maxWidth: 340 }}>
              Dein Konto wartet auf die Freischaltung durch den Administrator. Du bekommst
              Zugriff, sobald dein Zugang bestätigt wurde — schau einfach später wieder vorbei.
            </p>
          </div>
          <button
            className="btn btn--outlined"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.logout()
              } catch {
                /* ignore */
              }
              onLogout()
            }}
          >
            <Icon name="logout" /> Abmelden
          </button>
        </motion.div>
      </div>
      <Footer />
    </div>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const { data: prompts, isLoading } = usePrompts()
  const { data: projects } = useProjects()
  const reorder = useReorder()
  const reorderBookmarks = useReorderBookmarks()
  const update = useUpdatePrompt()
  const del = useDeletePrompt()
  const duplicate = useDuplicatePrompt()
  const duplicateInPlace = useDuplicateInPlace()
  const merge = useMergePrompts()
  const runConfigQ = useRunConfig()
  const canRun = runConfigQ.isSuccess
  const createRun = useCreateRun()

  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem('cue-view')
    return saved === 'board' ||
      saved === 'list' ||
      saved === 'bookmarks' ||
      saved === 'runs' ||
      saved === 'sessions' ||
      saved === 'snippets' ||
      saved === 'projects' ||
      saved === 'settings'
      ? saved
      : 'board'
  })
  useEffect(() => {
    localStorage.setItem('cue-view', view)
  }, [view])
  const [q, setQ] = useState('')
  const [projectFilter, setProjectFilter] = useState<number | 'all' | 'none'>(() => {
    const saved = localStorage.getItem('cue-project-filter')
    if (saved === 'all' || saved === 'none') return saved
    const n = saved ? Number(saved) : NaN
    return Number.isFinite(n) ? n : 'all'
  })
  useEffect(() => {
    localStorage.setItem('cue-project-filter', String(projectFilter))
  }, [projectFilter])
  const [showExtra, setShowExtra] = useState(false)

  // If the persisted filter points at a project that no longer exists, reset.
  useEffect(() => {
    if (typeof projectFilter === 'number' && projects && !projects.some((p) => p.id === projectFilter)) {
      setProjectFilter('all')
    }
  }, [projects, projectFilter])

  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [detail, setDetail] = useState<Prompt | null>(null)
  // Prompts pending deletion (hidden immediately; really deleted after the undo window).
  const [pendingDelete, setPendingDelete] = useState<number[]>([])
  const [shortcuts, setShortcuts] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Multi-select / merge mode.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [runDialog, setRunDialog] = useState<{ kind: RunKind; prompts: Prompt[] } | null>(null)
  const [sendTarget, setSendTarget] = useState<{ text: string; projectId: number | null } | null>(
    null,
  )
  const searchRef = useRef<HTMLInputElement>(null)

  function exitSelect() {
    setSelectMode(false)
    setSelectedIds([])
    setMergeOpen(false)
  }
  function toggleSelect(p: Prompt) {
    setSelectedIds((prev) =>
      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
    )
  }
  // Cmd/Ctrl+click on a card/row: toggle its selection and drive select mode
  // from the result — first mod+click enters selection (action bar appears),
  // deselecting the last one leaves it again.
  function modSelect(p: Prompt) {
    const next = selectedIds.includes(p.id)
      ? selectedIds.filter((x) => x !== p.id)
      : [...selectedIds, p.id]
    setSelectedIds(next)
    setSelectMode(next.length > 0)
    if (next.length === 0) setMergeOpen(false)
  }

  const pmap = useMemo(() => projectMap(projects), [projects])

  const filtered = useMemo(() => {
    const list = prompts ?? []
    const query = q.trim().toLowerCase()
    return list.filter((p) => {
      if (pendingDelete.includes(p.id)) return false
      if (projectFilter === 'none' && p.project_id != null) return false
      if (typeof projectFilter === 'number' && p.project_id !== projectFilter) return false
      if (query && !`${p.title} ${p.body} ${p.tags}`.toLowerCase().includes(query)) return false
      return true
    })
  }, [prompts, q, projectFilter, pendingDelete])

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
        (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || columnComparator(a, b),
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
        if (settings.copyAdvancesStatus && p.status === 'queued' && !p.blocked) {
          update.mutate({ id: p.id, patch: { status: 'running' } })
        }
      } else {
        toast.show('Kopieren fehlgeschlagen', 'error')
      }
    },
    [settings.copyAdvancesStatus, toast, update],
  )

  const handleToggleBookmark = useCallback(
    (p: Prompt) => {
      update.mutate({ id: p.id, patch: { bookmarked: !p.bookmarked } })
      vibrate(8)
      toast.show(p.bookmarked ? 'Bookmark entfernt' : 'Gebookmarkt', 'success')
    },
    [toast, update],
  )

  const handleDuplicate = useCallback(
    (p: Prompt) => {
      duplicateInPlace.mutate(p.id, {
        onSuccess: (copy) => {
          vibrate(8)
          toast.show(`Dupliziert: „${copy.title}"`, 'success')
        },
        onError: () => toast.show('Duplizieren fehlgeschlagen', 'error'),
      })
    },
    [duplicateInPlace, toast],
  )

  const handleToggleBlocked = useCallback(
    (p: Prompt) => {
      update.mutate({ id: p.id, patch: { blocked: !p.blocked } })
      vibrate(8)
      toast.show(p.blocked ? 'Blockierung aufgehoben' : 'Blockiert — wandert ans Spaltenende', 'success')
    },
    [toast, update],
  )

  // Single gate for every status change: blocked prompts refuse running/done.
  const applyStatus = useCallback(
    (p: Prompt, s: Status) => {
      if (p.blocked && (s === 'running' || s === 'done')) {
        toast.show('Prompt ist blockiert — erst Blockierung aufheben', 'error')
        return
      }
      update.mutate({ id: p.id, patch: { status: s } })
    },
    [toast, update],
  )

  const handleToggleTested = useCallback(
    (p: Prompt) => {
      update.mutate({ id: p.id, patch: { tested: !p.tested } })
      vibrate(8)
      toast.show(p.tested ? 'Als ungetestet markiert' : 'Als getestet markiert', 'success')
    },
    [toast, update],
  )

  // Delete with an undo window: hide immediately, commit to the server only
  // after the toast times out (or never, if undone).
  const requestDelete = useCallback(
    (ids: number[]) => {
      if (!ids.length) return
      setPendingDelete((prev) => Array.from(new Set([...prev, ...ids])))
      setDetail(null)
      vibrate(8)
      let undone = false
      const commit = () => setPendingDelete((prev) => prev.filter((x) => !ids.includes(x)))
      const timer = window.setTimeout(() => {
        if (undone) return
        ids.forEach((id) => del.mutate(id))
        commit()
      }, 6000)
      toast.show(ids.length === 1 ? 'Prompt gelöscht' : `${ids.length} Prompts gelöscht`, 'success', {
        action: {
          label: 'Rückgängig',
          onClick: () => {
            undone = true
            window.clearTimeout(timer)
            commit()
          },
        },
      })
    },
    [del, toast],
  )

  const anyModalOpen =
    composerOpen || !!detail || shortcuts || mergeOpen || !!runDialog || !!sendTarget

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
        else if (sendTarget) setSendTarget(null)
        else if (runDialog) setRunDialog(null)
        else if (mergeOpen) setMergeOpen(false)
        else if (composerOpen) {
          setComposerOpen(false)
          setEditing(null)
        } else if (detail) setDetail(null)
        else if (selectMode) exitSelect()
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
          if (e.key === '1') applyStatus(detailLive, 'queued')
          if (e.key === '2') applyStatus(detailLive, 'running')
          if (e.key === '3') applyStatus(detailLive, 'done')
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
        } else if (e.key === '1') applyStatus(p, 'queued')
        else if (e.key === '2') applyStatus(p, 'running')
        else if (e.key === '3') applyStatus(p, 'done')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    anyModalOpen,
    applyStatus,
    composerOpen,
    detail,
    detailLive,
    handleCopy,
    mergeOpen,
    navOrder,
    prompts,
    runDialog,
    sendTarget,
    selectMode,
    selectedId,
    shortcuts,
    update,
  ])

  function openDetail(p: Prompt) {
    if (selectMode) return
    setSelectedId(p.id)
    setDetail(p)
  }

  return (
    <div className="app">
      <TopBar
        view={view}
        onView={setView}
        onShortcuts={() => setShortcuts(true)}
        canRun={canRun}
        projectLabel={
          view === 'board'
            ? projectFilter === 'all'
              ? { text: 'Alle Projekte' }
              : projectFilter === 'none'
                ? { text: 'Ohne Projekt' }
                : {
                    text: pmap.get(projectFilter)?.name ?? '…',
                    color: pmap.get(projectFilter)?.color,
                  }
            : null
        }
      />
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
              {(view === 'board' || view === 'list') && (
                <button
                  className="chip"
                  data-active={showExtra}
                  onClick={() => setShowExtra((v) => !v)}
                >
                  <Icon name={showExtra ? 'unfold_less' : 'unfold_more'} /> Failed / Archived
                </button>
              )}
              {(view === 'board' || view === 'list') && (
                <button
                  className="chip"
                  data-active={selectMode}
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  title="Mehrere Prompts auswählen & zusammenführen"
                >
                  <Icon name="library_add_check" /> {selectMode ? 'Auswahl beenden' : 'Auswählen'}
                </button>
              )}
            </div>

            <ProjectChips
              projects={projects ?? []}
              filter={projectFilter}
              setFilter={setProjectFilter}
            />

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
                onDuplicate={handleDuplicate}
                onToggleBookmark={handleToggleBookmark}
                onToggleTested={handleToggleTested}
                onToggleBlocked={handleToggleBlocked}
                onReorder={(items) => reorder.mutate(items)}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onModSelect={modSelect}
              />
            ) : (
              <ListView
                prompts={filtered}
                projects={pmap}
                columns={columns}
                dark={settings.resolvedDark}
                selectedId={selectedId}
                onOpen={openDetail}
                onCopy={handleCopy}
                onDuplicate={handleDuplicate}
                onToggleBookmark={handleToggleBookmark}
                onToggleTested={handleToggleTested}
                onToggleBlocked={handleToggleBlocked}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onModSelect={modSelect}
              />
            )}
          </>
        )}

        {view === 'bookmarks' && (
          <BookmarksView
            prompts={filtered}
            projects={pmap}
            dark={settings.resolvedDark}
            selectedId={selectedId}
            onOpen={openDetail}
            onCopy={handleCopy}
            onDuplicate={handleDuplicate}
            onToggleBookmark={handleToggleBookmark}
            onToggleTested={handleToggleTested}
            onReorder={(items) => reorderBookmarks.mutate(items)}
          />
        )}

        {view === 'runs' && <RunsView canRun={canRun} />}
        {view === 'snippets' && <SnippetsView />}
        {view === 'sessions' && <SessionsView dark={settings.resolvedDark} />}

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

      <RunTicker enabled={canRun && view !== 'runs'} onOpen={() => setView('runs')} />

      {(view === 'board' || view === 'list') && !composerOpen && !selectMode && (
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

      {/* Deliberately NOT inside AnimatePresence: its exit never visibly played
          (the bar froze ~2 s at full opacity, then popped away — regardless of
          spring or tween). Spring entrance stays; removal is instant. */}
      {selectMode && !mergeOpen && (
          <motion.div
            key="select-bar"
            className="select-bar"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.spatial}
          >
            <span className="select-count">{selectedIds.length} ausgewählt</span>
            <button className="btn btn--text" onClick={exitSelect}>
              Abbrechen
            </button>
            <button
              className="btn btn--danger"
              disabled={selectedIds.length < 1}
              onClick={() => {
                const ids = selectedIds
                exitSelect()
                requestDelete(ids)
              }}
            >
              <Icon name="delete" /> Löschen
            </button>
            {canRun && (
              <button
                className="btn btn--tonal"
                disabled={selectedIds.length < 1}
                onClick={() => {
                  const ps = selectedIds
                    .map((id) => (prompts ?? []).find((p) => p.id === id))
                    .filter(Boolean) as Prompt[]
                  if (ps.length) setRunDialog({ kind: ps.length > 1 ? 'chain' : 'single', prompts: ps })
                }}
              >
                <Icon name="play_arrow" /> Ausführen
              </button>
            )}
            <button
              className="btn btn--filled"
              disabled={selectedIds.length < 2}
              onClick={() => setMergeOpen(true)}
            >
              <Icon name="merge" /> Zusammenführen
            </button>
          </motion.div>
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
            projects={projects ?? []}
            dark={settings.resolvedDark}
            onClose={() => setDetail(null)}
            onCopy={handleCopy}
            onEdit={(p) => {
              setEditing(p)
              setDetail(null)
              setComposerOpen(true)
            }}
            onDelete={(p) => requestDelete([p.id])}
            onStatus={applyStatus}
            onToggleBookmark={handleToggleBookmark}
            onToggleTested={handleToggleTested}
            onToggleBlocked={handleToggleBlocked}
            onMoveProject={(p, pid) => {
              update.mutate({
                id: p.id,
                patch: pid == null ? { unassign_project: true, project_id: null } : { project_id: pid },
              })
              const name = pid == null ? null : pmap.get(pid)?.name
              toast.show(name ? `Verschoben nach „${name}"` : 'Projekt entfernt', 'success')
            }}
            onCopyToProject={(p, pid) => {
              duplicate.mutate(
                { id: p.id, projectId: pid },
                {
                  onSuccess: () => {
                    const name = pid == null ? null : pmap.get(pid)?.name
                    toast.show(
                      name ? `Kopie in „${name}" erstellt (Queued)` : 'Kopie erstellt (Queued)',
                      'success',
                    )
                  },
                  onError: () => toast.show('Kopieren fehlgeschlagen', 'error'),
                },
              )
            }}
            onRun={
              canRun
                ? (p) => {
                    setDetail(null)
                    setRunDialog({ kind: 'single', prompts: [p] })
                  }
                : undefined
            }
            onSend={
              canRun
                ? (p) => {
                    setDetail(null)
                    setSendTarget({ text: p.body, projectId: p.project_id })
                  }
                : undefined
            }
          />
        )}
        {mergeOpen && (
          <MergeDialog
            key="merge"
            parts={
              selectedIds
                .map((id) => (prompts ?? []).find((p) => p.id === id))
                .filter(Boolean) as Prompt[]
            }
            projects={projects ?? []}
            onClose={() => setMergeOpen(false)}
            onConfirm={(payload) => {
              merge.mutate(payload, {
                onSuccess: () => {
                  exitSelect()
                  toast.show('Prompts zusammengeführt', 'success')
                },
                onError: () => toast.show('Zusammenführen fehlgeschlagen', 'error'),
              })
            }}
          />
        )}
        {runDialog && runConfigQ.data && (
          <RunDialog
            key="run-dialog"
            kind={runDialog.kind}
            prompts={runDialog.prompts}
            config={runConfigQ.data}
            busy={createRun.isPending}
            onClose={() => setRunDialog(null)}
            onSubmit={(payload: RunPayload) => {
              createRun.mutate(payload, {
                onSuccess: () => {
                  setRunDialog(null)
                  exitSelect()
                  setView('runs')
                  toast.show('Run gestartet', 'success')
                },
                onError: () => toast.show('Start fehlgeschlagen', 'error'),
              })
            }}
          />
        )}
        {sendTarget && (
          <SendToSessionDialog
            key="send-dialog"
            text={sendTarget.text}
            projectId={sendTarget.projectId}
            onClose={() => setSendTarget(null)}
          />
        )}
        {shortcuts && <ShortcutsOverlay key="shortcuts" onClose={() => setShortcuts(false)} />}
      </AnimatePresence>
    </div>
  )
}
