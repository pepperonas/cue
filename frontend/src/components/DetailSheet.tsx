import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { projectTones } from '../lib/color'
import { prefersReducedMotion, springs } from '../lib/motion'
import { renderMarkdown } from '../lib/markdown'
import type { Optimization, Priority, Project, Prompt, Status } from '../lib/types'
import { STATUS_CLASS, STATUS_ICON, STATUS_LABEL, STATUSES } from '../lib/types'
import { BlockedButton } from './BlockedButton'
import { BookmarkButton } from './BookmarkButton'
import { TestedButton } from './TestedButton'
import { DecisionBar } from './optimize/DecisionBar'
import { RelativeTime } from './RelativeTime'
import { isOptimizable } from '../lib/optimization'
import { promptTimes } from '../lib/relative-time'
import { OptimizationPanel, type PromptVariant } from './optimize/OptimizationPanel'
import { OptimizeButton } from './optimize/OptimizeButton'
import { PromptEditor } from './PromptEditor'
import { PrioritySelect } from './PriorityButton'
import { CloseTestButton } from './CloseTestButton'
import { useBackDismiss } from '../state/overlays'
import { usePendingProposal } from '../state/queries'
import { Button, Icon, IconButton } from './ui'

interface Props {
  prompt: Prompt
  project?: Project
  projects: Project[]
  dark: boolean
  onClose: () => void
  onCopy: (p: Prompt) => void
  /** Switch this sheet into edit mode — it does NOT open a second dialog. */
  onEdit: (p: Prompt) => void
  /** True while the sheet shows the form instead of the prompt. */
  editing?: boolean
  /** Leave edit mode without saving. */
  onCancelEdit?: () => void
  onDelete: (p: Prompt) => void
  onStatus: (p: Prompt, s: Status) => void
  onToggleBookmark: (p: Prompt) => void
  onToggleTested: (p: Prompt) => void
  onToggleBlocked: (p: Prompt) => void
  onSetPriority?: (p: Prompt, next: Priority) => void
  onToggleCloseTest?: (p: Prompt) => void
  onMoveProject: (p: Prompt, projectId: number | null) => void
  onCopyToProject: (p: Prompt, projectId: number | null) => void
  onRun?: (p: Prompt) => void
  onSend?: (p: Prompt) => void
  // Prompt optimization (owner-only; absent for everyone else).
  canOptimize?: boolean
  optimizeBusy?: boolean
  activeOptimization?: Optimization | null
  onOptimize?: (p: Prompt) => void
  onCancelOptimize?: (id: number) => void
  /** Review a finished proposal: apply it into the prompt text, or drop it. */
  onDecideOptimization?: (optimization: Optimization, apply: boolean) => void
  decidingOptimization?: boolean
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function DetailSheet({
  prompt,
  project,
  projects,
  dark,
  onClose,
  onCopy,
  onEdit,
  editing = false,
  onCancelEdit,
  onDelete,
  onStatus,
  onToggleBookmark,
  onToggleTested,
  onToggleBlocked,
  onSetPriority,
  onToggleCloseTest,
  onMoveProject,
  onCopyToProject,
  onRun,
  onSend,
  canOptimize = false,
  optimizeBusy = false,
  activeOptimization = null,
  onOptimize,
  onCancelOptimize,
  onDecideOptimization,
  decidingOptimization,
}: Props) {
  // Back closes the sheet; the nested lightbox and the project popover
  // register on top of it, so back peels them off one by one.
  useBackDismiss(onClose)
  const [showRaw, setShowRaw] = useState(false)
  // Which text the sheet renders: the untouched original, the optimized
  // version, or the diff between them. Reset whenever another prompt opens.
  const [variant, setVariant] = useState<PromptVariant>('original')
  const [pickedVersion, setPickedVersion] = useState<number | null>(null)
  const [versionText, setVersionText] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [projMenu, setProjMenu] = useState(false)
  const [projMode, setProjMode] = useState<'move' | 'copy'>('move')
  const projWrapRef = useRef<HTMLSpanElement>(null)
  const canTest = prompt.status === 'running' || prompt.status === 'done'
  const canBlock = prompt.status === 'queued'
  const tones = project ? projectTones(project.color, dark) : null
  const contentRef = useRef<HTMLDivElement>(null)
  useBackDismiss(() => setLightbox(null), lightbox !== null)
  useBackDismiss(() => setProjMenu(false), projMenu)
  // Registered on top of the sheet's own dismissal, so back/Escape steps out of
  // the form first and only closes the sheet on the second press.
  useBackDismiss(() => onCancelEdit?.(), editing)
  // The view animates back in only after the sheet has been in edit mode. On
  // the very first render the sheet is animating itself in, and a second
  // entrance on top of that reads as a stutter.
  const [everEdited, setEverEdited] = useState(false)
  useEffect(() => {
    if (editing) setEverEdited(true)
  }, [editing])
  // The proposal this prompt is holding open for review, if the user may decide
  // at all. Shares the history query with the panel below — no extra request.
  const proposal = usePendingProposal(canOptimize ? prompt : null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrolledTo = useRef<number | null>(null)

  // A prompt with a waiting proposal opens ON the diff — the badges, status
  // chips and copy button above it are ~180 px of chrome nobody came for. Once
  // per prompt only: a re-optimization finishing while the sheet is open must
  // not yank the view away from whatever is being read.
  //
  // This depends on the diff rendering at full height in the same commit the
  // proposal arrives. While it grew out of an AnimatePresence height animation
  // the content was still short here, `scrollTop` clamped to 0, and the scroll
  // silently did nothing — see the note in OptimizationPanel.
  useEffect(() => {
    if (!proposal || scrolledTo.current === prompt.id) return
    const scroller = scrollRef.current
    const panel = panelRef.current
    if (!scroller || !panel) return
    scrolledTo.current = prompt.id
    scroller.scrollTop +=
      panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  }, [proposal, prompt.id])

  // A different prompt (or a fresh optimization) resets the variant switch.
  // An undecided proposal opens on the DIFF: that is the view the decision is
  // made from, so it should not have to be found first.
  useEffect(() => {
    setVariant(prompt.optimized ? 'diff' : 'original')
    setPickedVersion(null)
    setVersionText(null)
  }, [prompt.id, prompt.optimized])

  // The text the user currently sees — copy/select-all operate on exactly this.
  const shownBody =
    variant === 'optimized'
      ? versionText ?? prompt.optimized_body ?? prompt.body
      : prompt.body

  // Project menu: close on outside click; Escape closes just the menu (captured
  // before the global handler would close the whole sheet).
  useEffect(() => {
    if (!projMenu) return
    function onDown(e: PointerEvent) {
      if (projWrapRef.current && !projWrapRef.current.contains(e.target as Node)) {
        setProjMenu(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setProjMenu(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onEsc, true)
    }
  }, [projMenu])

  function chooseProject(projectId: number | null) {
    setProjMenu(false)
    const current = prompt.project_id ?? null
    if (projMode === 'move') {
      if (projectId !== current) onMoveProject(prompt, projectId)
    } else {
      onCopyToProject(prompt, projectId)
    }
  }

  // Cmd/Ctrl+A selects only the prompt content (not the whole page behind the
  // sheet), so a following Cmd/Ctrl+C copies just the prompt.
  useEffect(() => {
    // While editing, the textarea owns both combos: select-all must stay inside
    // the field, and Cmd/Ctrl+C must copy the SELECTION. A textarea selection is
    // not part of `window.getSelection()` in Chrome, so the guard below would
    // not see it and this handler would copy the whole prompt instead.
    if (editing) return
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'a') {
        const node = contentRef.current
        const sel = window.getSelection()
        if (!node || !sel) return
        e.preventDefault()
        const range = document.createRange()
        range.selectNodeContents(node)
        sel.removeAllRanges()
        sel.addRange(range)
      } else if (key === 'c') {
        // Direct Cmd/Ctrl+C with no active selection copies the whole prompt.
        const sel = window.getSelection()
        if (sel && sel.toString().length > 0) return
        e.preventDefault()
        onCopy(prompt)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onCopy, prompt])

  // Cmd/Ctrl+Enter takes a pending proposal over: reviewing means reading the
  // diff, and the decision should not need the mouse. Both modifiers on every
  // platform, for the reason in lib/platform.ts.
  useEffect(() => {
    // Not while editing — there Cmd/Ctrl+Enter saves, and both firing on one
    // press would apply a proposal the user never looked at.
    if (!proposal || decidingOptimization || editing) return
    const open = proposal
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      onDecideOptimization?.(open, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [proposal, decidingOptimization, editing, onDecideOptimization])

  /** Entrance of the view content when it comes back from the form. Mirrors
   *  the editor's own, but settles DOWN from above where the form rises from
   *  below — so the two directions read as leaving and returning. */
  const reduce = prefersReducedMotion()
  const viewEnter = (step: number) =>
    everEdited && !reduce
      ? {
          initial: { opacity: 0, y: -12 },
          animate: { opacity: 1, y: 0 },
          transition: { ...springs.spatialFast, delay: step * 0.045 },
        }
      : {}

  return (
    <motion.div
      className="scrim"
      // Editing never closes on a backdrop click — an accidental click outside
      // must not throw away what was typed. Same rule as the composer.
      onClick={editing ? undefined : onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      {/* An explicit enter/exit, NOT a shared `layoutId`. The sheet used to
          carry `layoutId={`card-${id}`}` for a container transform out of the
          board card — but no card ever declared that id, so the shared layout
          had no partner. It could morph from nothing while still making motion
          defer the unmount, and that deferral never resolved: closing set the
          state to null and the dialog stayed on screen, unclosable. */}
      <motion.div
        className={`sheet sheet--detail${editing ? ' sheet--editing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.12 } }}
        transition={springs.spatial}
      >
        {editing ? (
          <PromptEditor
            projects={projects}
            editing={prompt}
            defaultProjectId={prompt.project_id}
            scrollClassName="detail-scroll"
            idPrefix="d"
            cancelIcon="arrow_back"
            cancelLabel="Bearbeiten beenden"
            onCancel={() => onCancelEdit?.()}
            onSaved={() => onCancelEdit?.()}
            animateIn
          />
        ) : (
          <>
          {/* Wraps: a long title plus four icon buttons overflowed a phone-width
              sheet, and the close button was the part that got cut off. */}
          <motion.div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}
            {...viewEnter(0)}
          >
            {/* A basis, not `auto`: with `auto` the title's one-line width decides
                whether the row wraps, so a long title pushed the buttons onto
                their own line even on a wide sheet. */}
            <h2 style={{ margin: 0, flex: '1 1 260px', minWidth: 0, overflowWrap: 'anywhere' }}>
              {prompt.title || 'Untitled'}
            </h2>
            <div className="row">
              {onToggleCloseTest && prompt.status === 'done' && (
                <CloseTestButton
                  variant="icon-btn"
                  marked={prompt.test_closely}
                  onToggle={() => onToggleCloseTest(prompt)}
                />
              )}
              {canTest && (
                <TestedButton
                  variant="icon-btn"
                  tested={prompt.tested}
                  disabled={prompt.status !== 'done'}
                  onToggle={() => onToggleTested(prompt)}
                />
              )}
              {canBlock && (
                <BlockedButton
                  variant="icon-btn"
                  blocked={prompt.blocked}
                  onToggle={() => onToggleBlocked(prompt)}
                />
              )}
              {canOptimize && onOptimize && isOptimizable(prompt) && (
                <OptimizeButton
                  variant="icon-btn"
                  prompt={prompt}
                  busy={optimizeBusy}
                  onOptimize={onOptimize}
                />
              )}
              <BookmarkButton
                variant="icon-btn"
                bookmarked={prompt.bookmarked}
                onToggle={() => onToggleBookmark(prompt)}
              />
              <IconButton icon="close" label="Schließen" onClick={onClose} />
            </div>
          </motion.div>

          {/* Everything between the header and the pinned footer scrolls as ONE
              region. It used to stop above the optimization panel, so the panel —
              by far the tallest and most variable element, a 400 px diff plus its
              controls — sat in the pinned region and was simply clipped by the
              sheet's `overflow: hidden`. There was no way to scroll to what came
              after it. */}
          <motion.div className="detail-scroll" ref={scrollRef} {...viewEnter(1)}>
          <div className="card-meta">
            <span ref={projWrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                className="badge badge-btn"
                style={
                  project && tones
                    ? { background: tones.container, color: tones.on }
                    : { background: 'var(--md-surface-container-highest)' }
                }
                title="Projekt ändern oder Prompt in anderes Projekt kopieren"
                onClick={() => setProjMenu((v) => !v)}
              >
                <span
                  className="dot"
                  style={{ background: tones ? tones.accent : 'var(--md-outline)' }}
                />
                {project ? project.name : 'Kein Projekt'}
                <Icon name={projMenu ? 'expand_less' : 'expand_more'} className="badge-caret" />
              </button>
              {projMenu && (
                <motion.div
                  className="proj-menu"
                  initial={{ opacity: 0, scale: 0.94, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={springs.spatialFast}
                >
                  <div className="proj-menu-modes">
                    <button
                      className="chip"
                      data-active={projMode === 'move'}
                      onClick={() => setProjMode('move')}
                    >
                      <Icon name="drive_file_move" /> Verschieben
                    </button>
                    <button
                      className="chip"
                      data-active={projMode === 'copy'}
                      onClick={() => setProjMode('copy')}
                    >
                      <Icon name="content_copy" /> Kopieren
                    </button>
                  </div>
                  <div className="proj-menu-list">
                    <button className="proj-menu-item" onClick={() => chooseProject(null)}>
                      <span className="dot" style={{ background: 'var(--md-outline)' }} />
                      Kein Projekt
                      {prompt.project_id == null && projMode === 'move' && (
                        <Icon name="check" className="proj-menu-check" />
                      )}
                    </button>
                    {projects.map((pr) => (
                      <button
                        key={pr.id}
                        className="proj-menu-item"
                        onClick={() => chooseProject(pr.id)}
                      >
                        <span className="dot" style={{ background: pr.color }} />
                        {pr.name}
                        {prompt.project_id === pr.id && projMode === 'move' && (
                          <Icon name="check" className="proj-menu-check" />
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </span>
            <span className="badge" style={{ background: 'var(--md-surface-container-highest)' }}>
              <Icon
                name={STATUS_ICON[prompt.status]}
                className={`st-icon ${STATUS_CLASS[prompt.status]}`}
              />{' '}
              {STATUS_LABEL[prompt.status]}
            </span>
          </div>

          <div className="detail-status">
            {STATUSES.map((s) => (
              <button
                key={s}
                className="chip"
                data-active={prompt.status === s}
                disabled={prompt.blocked && (s === 'running' || s === 'done')}
                title={
                  prompt.blocked && (s === 'running' || s === 'done')
                    ? 'Blockiert — erst Blockierung aufheben'
                    : undefined
                }
                onClick={() => onStatus(prompt, s)}
              >
                <Icon name={STATUS_ICON[s]} className={`st-icon ${STATUS_CLASS[s]}`} /> {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {onSetPriority && (
            <div className="detail-prio">
              <label htmlFor="d-prio-view" className="muted">
                Priorität
              </label>
              <PrioritySelect
                id="d-prio-view"
                priority={prompt.priority}
                onChange={(next) => onSetPriority(prompt, next)}
              />
              {/* Only the queue is banded by it — saying so beats leaving the
                  user to wonder why nothing moved. */}
              {prompt.status !== 'queued' && (
                <span className="muted detail-prio-note">wirkt in der Queue</span>
              )}
            </div>
          )}

          <Button
            variant="filled"
            icon="content_copy"
            onClick={() => onCopy(prompt)}
            style={{ height: 56, flexShrink: 0, fontSize: '1rem' }}
          >
            In Zwischenablage kopieren
          </Button>

          {canOptimize && onOptimize && (
            <div ref={panelRef}>
            <OptimizationPanel
              prompt={prompt}
              view={variant}
              onView={(next) => {
                setVariant(next)
                // Leaving the optimized view drops a pinned old version.
                if (next === 'original') setVersionText(null)
              }}
              busy={optimizeBusy}
              activeJob={activeOptimization}
              onOptimize={() => onOptimize(prompt)}
              onCancel={() => activeOptimization && onCancelOptimize?.(activeOptimization.id)}
              selectedVersion={pickedVersion}
              onOpenVersion={(row) => {
                setPickedVersion(row.version)
                setVersionText(row.optimized_text ?? null)
                setVariant('optimized')
              }}
            />
            </div>
          )}

          {/* The diff replaces the body while it is active, so its label and the
              raw/preview toggle would head an empty box. */}
          {variant !== 'diff' && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                {variant === 'optimized'
                  ? `Optimierte Fassung${pickedVersion ? ` (v${pickedVersion})` : ''}`
                  : 'Inhalt'}
              </span>
              <button className="chip" onClick={() => setShowRaw((v) => !v)}>
                <Icon name={showRaw ? 'visibility' : 'code'} /> {showRaw ? 'Vorschau' : 'Rohtext'}
              </button>
            </div>
          )}

          {/* Stays mounted even in diff view: Cmd/Ctrl+A scopes the selection to
              this node, and without it select-all would grab the page behind. */}
          <div
            ref={contentRef}
            style={{ userSelect: 'text', cursor: 'text' }}
            title="Doppelklick zum Bearbeiten"
            onDoubleClick={() => onEdit(prompt)}
          >
            {variant === 'diff' ? null : showRaw ? (
              <pre
                style={{
                  background: 'var(--md-surface-container-lowest)',
                  padding: 'var(--gap-4)',
                  borderRadius: 'var(--shape-s)',
                  overflow: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.82rem',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {shownBody}
              </pre>
            ) : (
              <div
                className="md-preview"
                style={{
                  background: 'var(--md-surface-container-lowest)',
                  padding: 'var(--gap-4)',
                  borderRadius: 'var(--shape-s)',
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(shownBody) }}
              />
            )}
          </div>

          {prompt.attachments.length > 0 && (
            <div>
              <span className="muted">Screenshots</span>
              <div className="attach-grid" style={{ marginTop: 'var(--gap-2)' }}>
                {prompt.attachments.map((a) => (
                  <button
                    className="attach-thumb attach-view"
                    key={a.id}
                    onClick={() => setLightbox(a.url)}
                    title={a.name}
                  >
                    <img src={a.url} alt={a.name} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.8 }}>
            {/* The age stands on its own line: it describes the last EDIT, so
                appending it to "Erstellt" would contradict the date next to it.
                The three absolute lines below stay the exact record — note that
                "Aktualisiert" also moves on a drag or a status change, which is
                precisely why it is not the one the age is derived from. */}
            <div>
              <RelativeTime prompt={prompt} />
            </div>
            <div>Erstellt: {fmt(prompt.created_at)}</div>
            {promptTimes(prompt).edited && <div>Bearbeitet: {fmt(prompt.edited_at ?? null)}</div>}
            <div>Aktualisiert: {fmt(prompt.updated_at)}</div>
            <div>Gestartet: {fmt(prompt.ran_at)}</div>
          </div>
          </motion.div>

          {proposal && (
            <DecisionBar
              proposal={proposal}
              busy={!!decidingOptimization}
              onApply={() => onDecideOptimization?.(proposal, true)}
              onDiscard={() => onDecideOptimization?.(proposal, false)}
            />
          )}

          <motion.div className="row-end" {...viewEnter(2)}>
            <Button variant="danger" icon="delete" onClick={() => onDelete(prompt)}>
              Löschen
            </Button>
            {onRun && !prompt.blocked && (
              <Button variant="tonal" icon="play_arrow" onClick={() => onRun(prompt)}>
                Ausführen
              </Button>
            )}
            {onSend && (
              <Button variant="tonal" icon="send" onClick={() => onSend(prompt)}>
                An CLI senden
              </Button>
            )}
            <Button variant="tonal" icon="edit" onClick={() => onEdit(prompt)}>
              Bearbeiten
            </Button>
          </motion.div>
          </>
        )}
      </motion.div>

      {lightbox && (
        <div
          className="lightbox"
          onClick={(e) => {
            e.stopPropagation()
            setLightbox(null)
          }}
        >
          <img src={lightbox} alt="" />
        </div>
      )}
    </motion.div>
  )
}
