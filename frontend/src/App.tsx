import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, enableDemo } from './lib/api'
import { detailAction } from './lib/detail-keys'
import type { MovePayload } from './lib/api'
import { copyText, vibrate } from './lib/clipboard'
import { springs } from './lib/motion'
import { countOpenByProject } from './lib/board-groups'
import { bookmarkedPrompts, filterPrompts } from './lib/filter'
import { withChunkRecovery } from './lib/lazy-chunk'
import { columnComparator } from './lib/order'
import {
  BOARD_COLUMNS,
  EXTRA_COLUMNS,
  STATUS_CLASS,
  PRIORITY_LABEL,
  STATUS_ICON,
  STATUS_LABEL,
  type Me,
  type Optimization,
  type Priority,
  type Prompt,
  type RunKind,
  type StatsQuery,
  type Status,
} from './lib/types'
import {
  projectMap,
  useActiveOptimizations,
  useCancelOptimization,
  useCreateRun,
  useDeletePrompt,
  useDuplicateInPlace,
  useDuplicatePrompt,
  useApplyOptimization,
  useDiscardOptimization,
  useMergePrompts,
  usePrompts,
  useProjects,
  useMoveBookmark,
  useMovePrompt,
  useMovePrompts,
  useOptimizeConfig,
  useRefreshOnOptimizationFinish,
  useOptimizePrompt,
  useRunConfig,
  useStartOptimizeBatch,
  useUpdatePrompt,
} from './state/queries'
import { useLiveSync } from './state/live-sync'
import { useCloseTopOverlay } from './state/overlays'
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
import { BatchTicker } from './components/optimize/BatchTicker'
import { SessionsView } from './components/SessionsView'
import { SnippetsView } from './components/SnippetsView'
import { DetailSheet } from './components/DetailSheet'
import { ListView } from './components/ListView'
import { Landing } from './components/Landing'
import { DemoBanner } from './components/DemoBanner'
import { useRoute } from './state/route'
import { ProjectChips } from './components/ProjectChips'
import { ProjectsView } from './components/ProjectsView'
import { SettingsView } from './components/SettingsView'
import { TagsView } from './components/TagsView'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { TopBar, type View } from './components/TopBar'
import { Footer, Icon } from './components/ui'

// The statistics dashboard pulls in Recharts — lazy-loaded so the chart
// library only reaches the browser when the tab is actually opened. Wrapped
// because a deploy deletes the chunk this tab was told to ask for (see
// lib/lazy-chunk.ts).
const StatsView = lazy(withChunkRecovery('stats', () => import('./components/stats/StatsView')))

export default function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading')
  const { route, toLanding, toDemo, toApp } = useRoute()

  // ⚠️ VOR dem ersten `api.me()`: der Demo-Modus wird an genau einer Naht
  // eingeschaltet (`lib/api.ts`), und die allererste Anfrage der App ist
  // `/auth/me`. Erst im Effekt umzuschalten hieße, dass diese eine Anfrage
  // noch an den echten Server ginge — und der antwortet einem Besucher mit
  // „nicht angemeldet".
  if (route === 'demo') enableDemo()

  // ⚠️ Abhängig von der ROUTE, nicht nur vom Start: wer die Demo von der
  // Landing Page aus öffnet, hat diese Abfrage längst hinter sich — sie lief
  // gegen den echten Server und ergab „nicht angemeldet". Ohne das erneute
  // Holen zeigte `/demo` deshalb wieder die Landing Page statt des Boards.
  useEffect(() => {
    let aktuell = true
    setMe('loading')
    api
      .me()
      .then((m) => aktuell && setMe(m))
      .catch(() => aktuell && setMe(null))
    return () => {
      aktuell = false
    }
  }, [route])

  // Keeps this device in step with every other one on the account. Mounted
  // above the auth branches so it survives every view switch; it only starts
  // polling once there is a session to poll for.
  // ⚠️ In der Demo NICHT: die Schleife hält eine Anfrage offen, bis sich etwas
  // ändert — der Server antwortet dafür bis zu 25 s lang nicht. Die Demo
  // antwortet sofort „nichts geändert", und die Schleife fragte daraufhin
  // ununterbrochen nach und legte die Seite lahm (live gesehen: der Browser
  // reagierte nicht mehr). Zu synchronisieren gibt es hier ohnehin nichts —
  // es gibt kein zweites Gerät und keinen Server.
  useLiveSync(me !== 'loading' && !!me?.authenticated && !!me?.approved && route !== 'demo')

  // The landing page is public and answers first: it is the only address in
  // this app, and gating it behind the session would make the link unusable
  // for exactly the people it is written for.
  if (route === 'landing') {
    return (
      <Landing
        signedIn={!!me && me !== 'loading' && !!me.authenticated}
        onEnterApp={toApp}
        onDemo={toDemo}
      />
    )
  }
  if (me === 'loading') {
    return (
      <div className="app">
        <div className="login-wrap">
          <div className="skeleton" style={{ width: 200, height: 60 }} />
        </div>
      </div>
    )
  }
  // A visitor gets the landing page at `/` too — signing in is a call to
  // action there, not a wall in front of the explanation.
  if (!me || !me.authenticated) return <Landing onEnterApp={toLanding} onDemo={toDemo} />
  if (!me.approved) return <PendingApproval onLogout={() => setMe(null)} />
  return <Shell onLogout={() => setMe(null)} onLanding={toLanding} demo={route === 'demo'} />
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

function Shell({
  onLogout,
  onLanding,
  demo = false,
}: {
  onLogout: () => void
  onLanding: () => void
  /** Läuft die App auf erfundenen Daten? Setzt nur den Hinweisstreifen. */
  demo?: boolean
}) {
  const settings = useSettings()
  const toast = useToast()
  const closeTopOverlay = useCloseTopOverlay()
  const { data: prompts, isLoading } = usePrompts()
  const { data: projects } = useProjects()
  const movePrompt = useMovePrompt()
  const moveBookmark = useMoveBookmark()
  const movePrompts = useMovePrompts()
  const update = useUpdatePrompt()
  const del = useDeletePrompt()
  const duplicate = useDuplicatePrompt()
  const duplicateInPlace = useDuplicateInPlace()
  const merge = useMergePrompts()
  const runConfigQ = useRunConfig()
  const canRun = runConfigQ.isSuccess
  const createRun = useCreateRun()
  // Prompt optimization: owner-only, so a 403 on the config hides everything.
  const optimizeConfigQ = useOptimizeConfig()
  const canOptimize = optimizeConfigQ.isSuccess && optimizeConfigQ.data.enabled
  const optimizePrompt = useOptimizePrompt()
  const cancelOptimization = useCancelOptimization()
  const applyOptimization = useApplyOptimization()
  const discardOptimization = useDiscardOptimization()
  const startBatch = useStartOptimizeBatch()
  const { data: activeOptimizations } = useActiveOptimizations(canOptimize)
  const optimizingIds = useMemo(
    () => (activeOptimizations ?? []).map((o) => o.prompt_id),
    [activeOptimizations],
  )
  // A finished job means a prompt now carries a proposal — pull it in.
  useRefreshOnOptimizationFinish(optimizingIds)

  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem('cue-view')
    return saved === 'board' ||
      saved === 'list' ||
      saved === 'bookmarks' ||
      saved === 'runs' ||
      saved === 'sessions' ||
      saved === 'snippets' ||
      saved === 'projects' ||
      saved === 'tags' ||
      saved === 'stats' ||
      saved === 'settings'
      ? saved
      : 'board'
  })
  useEffect(() => {
    localStorage.setItem('cue-view', view)
  }, [view])
  // Selected statistics range (persisted, like the view and project filter).
  const [statsQuery, setStatsQuery] = useState<StatsQuery>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cue-stats-range') || 'null')
      if (saved && typeof saved.range === 'string') return saved as StatsQuery
    } catch {
      /* ignore malformed storage */
    }
    return { range: '30d' }
  })
  useEffect(() => {
    localStorage.setItem('cue-stats-range', JSON.stringify(statsQuery))
  }, [statsQuery])
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

  // Open prompts (queued + running) per project for the chip badges. Derived
  // from the UNFILTERED prompt list, so filtering doesn't zero the others, and
  // it re-renders with every optimistic status change — no refresh needed.
  const openCounts = useMemo(() => countOpenByProject(prompts ?? []), [prompts])

  // If the persisted filter points at a project that no longer exists, reset.
  useEffect(() => {
    if (typeof projectFilter === 'number' && projects && !projects.some((p) => p.id === projectFilter)) {
      setProjectFilter('all')
    }
  }, [projects, projectFilter])

  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [detail, setDetail] = useState<Prompt | null>(null)
  /**
   * Which prompt the DETAIL sheet is editing in place. An id, not a boolean:
   * closing the sheet or opening a different prompt then cannot leave a stale
   * "still editing" flag behind — there is no reset to forget.
   */
  const [editDetailId, setEditDetailId] = useState<number | null>(null)
  // Prompts pending deletion (hidden immediately; really deleted after the undo window).
  const [pendingDelete, setPendingDelete] = useState<number[]>([])
  // Same ids as a ref, so the pagehide handler below can read them without
  // re-subscribing on every state change.
  const unloadDeletes = useRef<Set<number>>(new Set())
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

  // Board + list follow the toolbar above them.
  const filtered = useMemo(() => {
    return filterPrompts(prompts ?? [], {
      pendingDelete,
      project: projectFilter,
      query: q,
    })
  }, [prompts, q, projectFilter, pendingDelete])

  // Bookmarks are global on purpose: the project chips and the search field
  // only exist above the board and the list, so honouring them here would hide
  // bookmarks because of a control the user cannot see on this tab.
  const bookmarks = useMemo(
    () => bookmarkedPrompts(prompts ?? [], pendingDelete),
    [prompts, pendingDelete],
  )

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
  const detailEditing = !!detailLive && editDetailId === detailLive.id

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

  const handleSetPriority = useCallback(
    (p: Prompt, next: Priority) => {
      if (next === p.priority) return
      update.mutate({ id: p.id, patch: { priority: next } })
      vibrate(8)
      // Only the queue is banded by priority, so only there is the toast about
      // a move; elsewhere the level is recorded and nothing jumps.
      toast.show(
        p.status === 'queued'
          ? `Priorität: ${PRIORITY_LABEL[next]} — Position in der Queue angepasst`
          : `Priorität: ${PRIORITY_LABEL[next]}`,
        'success',
      )
    },
    [toast, update],
  )

  const handleToggleCloseTest = useCallback(
    (p: Prompt) => {
      update.mutate({ id: p.id, patch: { test_closely: !p.test_closely } })
      vibrate(8)
      toast.show(
        p.test_closely ? 'Markierung entfernt' : 'Für genaues Testen markiert',
        'success',
      )
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

  // Only done prompts carry a tested flag (the toggle is disabled elsewhere —
  // this is the guard for any other path into it).
  // Move a whole selection between the columns — from a multi-card drag or
  // from the select bar's target buttons. Blocked prompts can't enter
  // running/done and are skipped server-side, so say so instead of leaving the
  // user wondering why one card stayed behind.
  const moveSelection = useCallback(
    (move: MovePayload & { ids: number[] }) => {
      const picked = (prompts ?? []).filter((p) => move.ids.includes(p.id))
      const skipped =
        move.status && move.status !== 'queued' ? picked.filter((p) => p.blocked).length : 0
      if (skipped === picked.length && picked.length > 0) {
        toast.show(
          picked.length === 1 ? 'Prompt ist blockiert' : 'Alle ausgewählten Prompts sind blockiert',
          'error',
        )
        return
      }
      movePrompts.mutate(move, {
        onSuccess: () => {
          if (skipped) {
            toast.show(
              skipped === 1
                ? '1 blockierter Prompt blieb liegen'
                : `${skipped} blockierte Prompts blieben liegen`,
              'info',
            )
          }
        },
        onError: (err) =>
          toast.show(err instanceof Error ? err.message : 'Verschieben fehlgeschlagen', 'error'),
      })
    },
    [movePrompts, prompts, toast],
  )

  // Queue an optimization for one prompt. The runner picks it up; the button
  // spins until the job leaves the active list.
  // Prompt whose optimization the user started by hand — when it finishes, its
  // diff is opened for review. Batches never set this: a run over 143 prompts
  // must not throw dialogs at anyone.
  const awaitingReview = useRef<number | null>(null)

  const handleOptimize = useCallback(
    (p: Prompt) => {
      awaitingReview.current = p.id
      optimizePrompt.mutate(
        { promptId: p.id },
        {
          onSuccess: () =>
            toast.show(
              p.optimized ? 'Erneute Optimierung gestartet' : 'Optimierung gestartet',
              'success',
            ),
          onError: (err) => {
            awaitingReview.current = null
            toast.show(
              err instanceof Error ? err.message : 'Optimierung fehlgeschlagen',
              'error',
            )
          },
        },
      )
      vibrate(8)
    },
    [optimizePrompt, toast],
  )


  // Review a finished proposal. Applying replaces the prompt text (the original
  // stays in the optimization history), discarding leaves it untouched.
  const handleDecideOptimization = useCallback(
    (optimization: Optimization, apply: boolean) => {
      const mutation = apply ? applyOptimization : discardOptimization
      mutation.mutate(optimization.id, {
        onSuccess: () => {
          // Decision taken — there is nothing left to review, so get out of the
          // way. The card behind already carries the new text (the mutation
          // wrote the updated prompt into the cache).
          setDetail(null)
          toast.show(
            apply ? 'Optimierung übernommen' : 'Optimierung verworfen',
            apply ? 'success' : 'info',
          )
        },
        onError: (err) =>
          toast.show(err instanceof Error ? err.message : 'Aktion fehlgeschlagen', 'error'),
      })
      vibrate(8)
    },
    [applyOptimization, discardOptimization, toast],
  )

  const handleOptimizeAll = useCallback(() => {
    startBatch.mutate(
      {
        project_id: typeof projectFilter === 'number' ? projectFilter : null,
        only_pending: true,
      },
      {
        onSuccess: (batch) =>
          toast.show(`Sammel-Optimierung gestartet: ${batch.total} Prompts`, 'success'),
        onError: (err) =>
          toast.show(err instanceof Error ? err.message : 'Start fehlgeschlagen', 'error'),
      },
    )
  }, [projectFilter, startBatch, toast])

  const handleToggleTested = useCallback(
    (p: Prompt) => {
      if (p.status !== 'done') {
        toast.show('Nur erledigte Prompts können als getestet markiert werden', 'error')
        return
      }
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
      // Leaving the page must not swallow the deletion: without this the ids
      // would just reappear on the next load, having been reported as deleted.
      ids.forEach((id) => unloadDeletes.current.add(id))
      const settle = () => ids.forEach((id) => unloadDeletes.current.delete(id))
      const timer = window.setTimeout(() => {
        if (undone) return
        ids.forEach((id) => del.mutate(id))
        settle()
        commit()
      }, 6000)
      toast.show(ids.length === 1 ? 'Prompt gelöscht' : `${ids.length} Prompts gelöscht`, 'success', {
        action: {
          label: 'Rückgängig',
          onClick: () => {
            undone = true
            window.clearTimeout(timer)
            settle()
            commit()
          },
        },
      })
    },
    [del, toast],
  )

  // Commit deletions that are still inside their undo window when the page goes
  // away. `pagehide` (not `beforeunload`) is the event that also fires on iOS
  // and on bfcache navigations; the request needs `keepalive` to outlive us.
  useEffect(() => {
    const flush = () => {
      unloadDeletes.current.forEach((id) => api.deletePromptBeacon(id))
      unloadDeletes.current.clear()
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  const anyModalOpen =
    composerOpen || !!detail || shortcuts || mergeOpen || !!runDialog || !!sendTarget

  // Open a finished proposal for review — but never over something the user is
  // currently doing.
  useEffect(() => {
    const id = awaitingReview.current
    if (id == null || anyModalOpen) return
    const ready = (prompts ?? []).find((p) => p.id === id && p.optimized)
    if (!ready) return
    awaitingReview.current = null
    setDetail(ready)
  }, [prompts, anyModalOpen])

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
        // The overlay stack knows the real z-order (including dialogs nested
        // inside views), so Escape and the back gesture behave identically.
        if (closeTopOverlay()) return
        if (selectMode) exitSelect()
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
          // The table (and the "nothing fires while editing" rule) lives in
          // lib/detail-keys.ts, where it can be tested. `e` switches the OPEN
          // sheet into edit mode — it never opens a second dialog.
          const action = detailAction(e.key, { editing: detailEditing })
          if (action?.kind === 'copy') void handleCopy(detailLive)
          else if (action?.kind === 'edit') setEditDetailId(detailLive.id)
          else if (action?.kind === 'status') applyStatus(detailLive, action.status)
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
    closeTopOverlay,
    composerOpen,
    detail,
    detailEditing,
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
      {demo && <DemoBanner />}
      <TopBar
        view={view}
        onView={setView}
        onLanding={onLanding}
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
              {canOptimize && (view === 'board' || view === 'list') && (
                <button
                  className="chip chip--optimize"
                  disabled={startBatch.isPending}
                  onClick={handleOptimizeAll}
                  title={
                    typeof projectFilter === 'number'
                      ? 'Alle noch nicht optimierten Prompts dieses Projekts optimieren'
                      : 'Alle noch nicht optimierten Prompts optimieren'
                  }
                >
                  <Icon name="auto_awesome" /> Alle optimieren
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
              openCounts={openCounts}
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
                onOptimize={canOptimize ? handleOptimize : undefined}
                optimizingIds={optimizingIds}
                onToggleBlocked={handleToggleBlocked}
                onSetPriority={handleSetPriority}
                onToggleCloseTest={handleToggleCloseTest}
                onMove={(move) => movePrompt.mutate(move)}
                onMoveMany={moveSelection}
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
                onOptimize={canOptimize ? handleOptimize : undefined}
                optimizingIds={optimizingIds}
                onToggleBlocked={handleToggleBlocked}
                onSetPriority={handleSetPriority}
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
            prompts={bookmarks}
            projects={pmap}
            dark={settings.resolvedDark}
            selectedId={selectedId}
            onOpen={openDetail}
            onCopy={handleCopy}
            onDuplicate={handleDuplicate}
            onToggleBookmark={handleToggleBookmark}
            onToggleTested={handleToggleTested}
            onOptimize={canOptimize ? handleOptimize : undefined}
            optimizingIds={optimizingIds}
            onMove={(move) => moveBookmark.mutate(move)}
          />
        )}

        {view === 'runs' && <RunsView canRun={canRun} />}
        {view === 'snippets' && <SnippetsView />}
        {view === 'sessions' && <SessionsView dark={settings.resolvedDark} />}

        {view === 'projects' && <ProjectsView dark={settings.resolvedDark} />}
        {view === 'tags' && <TagsView />}
        {view === 'stats' && (
          <Suspense fallback={<div className="stats-view" aria-busy="true" />}>
            <StatsView query={statsQuery} onQuery={setStatsQuery} />
          </Suspense>
        )}
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
      <BatchTicker enabled={canOptimize} />

      {(view === 'board' || view === 'list' || view === 'bookmarks') &&
        !composerOpen &&
        !selectMode && (
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
            {view === 'bookmarks' ? 'Neues Bookmark' : 'Neuer Prompt'}
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
            {/* Move targets. Dragging the selection does the same thing, but a
                multi-card drag is awkward on a phone — and across a collapsed
                mobile section it is barely possible at all. */}
            {view === 'board' && (
              <span className="select-move" role="group" aria-label="Verschieben nach">
                <Icon name="drive_file_move" className="select-move-icon" />
                {BOARD_COLUMNS.map((status) => (
                  <button
                    key={status}
                    className="btn btn--outlined btn--compact"
                    disabled={selectedIds.length < 1}
                    title={`Auswahl nach ${STATUS_LABEL[status]} verschieben`}
                    onClick={() => {
                      const ids = selectedIds
                      exitSelect()
                      // Done keeps its "newest on top" rule for a bulk move too.
                      moveSelection({ ids, status, top: status === 'done' })
                    }}
                  >
                    <Icon name={STATUS_ICON[status]} className={STATUS_CLASS[status]} />
                    {STATUS_LABEL[status]}
                  </button>
                ))}
              </span>
            )}
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
            asBookmark={view === 'bookmarks' && !editing}
            onClose={() => {
              setComposerOpen(false)
              setEditing(null)
            }}
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

      {/* Deliberately OUTSIDE AnimatePresence. Its exit repeatedly failed to
          resolve: the sheet contains shared-layout elements (the version
          switcher's indicator) that are still animating while it is removed,
          and motion then never finishes the exit — closing set the state to
          null and the dialog stayed on screen, unclosable. Same call as the
          `.select-bar`. The entrance animation stays; removal is instant. */}
        {detailLive && !composerOpen && (
          <DetailSheet
            key="detail"
            prompt={detailLive}
            project={detailLive.project_id ? pmap.get(detailLive.project_id) : undefined}
            projects={projects ?? []}
            dark={settings.resolvedDark}
            onClose={() => {
              setDetail(null)
              // Zusammen abräumen: sonst stünde die Bearbeitungs-Markierung
              // noch, und derselbe Prompt öffnete beim nächsten Mal direkt im
              // Formular statt in der Ansicht.
              setEditDetailId(null)
            }}
            onCopy={handleCopy}
            editing={detailEditing}
            onCancelEdit={() => setEditDetailId(null)}
            onEdit={(p) => setEditDetailId(p.id)}
            onDelete={(p) => requestDelete([p.id])}
            onStatus={applyStatus}
            onToggleBookmark={handleToggleBookmark}
            onToggleTested={handleToggleTested}
            onToggleBlocked={handleToggleBlocked}
            onSetPriority={handleSetPriority}
            onToggleCloseTest={handleToggleCloseTest}
            canOptimize={canOptimize}
            optimizeBusy={optimizingIds.includes(detailLive.id)}
            activeOptimization={
              (activeOptimizations ?? []).find((o) => o.prompt_id === detailLive.id) ?? null
            }
            onOptimize={handleOptimize}
            onCancelOptimize={(id) => cancelOptimization.mutate(id)}
            onDecideOptimization={handleDecideOptimization}
            decidingOptimization={applyOptimization.isPending || discardOptimization.isPending}
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
    </div>
  )
}
