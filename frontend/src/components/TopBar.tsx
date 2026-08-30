import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { useSettings } from '../state/settings'
import { Icon, IconButton } from './ui'

export type View =
  | 'board'
  | 'list'
  | 'bookmarks'
  | 'runs'
  | 'sessions'
  | 'snippets'
  | 'projects'
  | 'tags'
  | 'stats'
  | 'settings'

const TABS: { key: View; icon: string; label: string }[] = [
  { key: 'board', icon: 'view_kanban', label: 'Board' },
  { key: 'list', icon: 'list', label: 'Liste' },
  { key: 'bookmarks', icon: 'bookmark', label: 'Bookmarks' },
  { key: 'runs', icon: 'play_arrow', label: 'Runs' },
  { key: 'sessions', icon: 'history', label: 'Verlauf' },
  { key: 'snippets', icon: 'data_object', label: 'Snippets' },
  { key: 'projects', icon: 'folder', label: 'Projekte' },
  { key: 'tags', icon: 'sell', label: 'Tags' },
  { key: 'stats', icon: 'insights', label: 'Statistiken' },
]

export function TopBar({
  view,
  onView,
  onLanding,
  onShortcuts,
  canRun = false,
  projectLabel = null,
}: {
  view: View
  onView: (v: View) => void
  /** Back to the public landing page. */
  onLanding: () => void
  onShortcuts: () => void
  canRun?: boolean
  // Currently selected project (board view): shown next to the brand.
  projectLabel?: { text: string; color?: string } | null
}) {
  const s = useSettings()
  // Runs execute code on the owner's machine → owner-only. Verlauf is per-user.
  const tabs = TABS.filter((t) => t.key !== 'runs' || canRun)
  return (
    <header className="topbar">
      <div className="brand">
        {/* Clicking the wordmark goes to the landing page — the web's own
            convention, and it costs no room in a header that is already tight
            at 390 px. It used to reload the page; Cmd/Ctrl+R still does that,
            and the same "way back" also sits as an icon button on the right so
            it is reachable without knowing the convention. */}
        <button
          className="brand-btn"
          title="Zur Startseite"
          onClick={onLanding}
        >
          <img className="logo logo-img" src="/favicon.svg" alt="" width={34} height={34} />
          <span className="brand-name">cue</span>
        </button>
        {projectLabel && (
          <motion.span
            // Remount per label so the spring entrance replays on each change.
            key={projectLabel.text}
            className="brand-project"
            initial={{ opacity: 0, y: 8, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springs.bouncy}
          >
            {projectLabel.color && (
              <span className="dot" style={{ background: projectLabel.color }} />
            )}
            {projectLabel.text}
          </motion.span>
        )}
      </div>
      <div className="topbar-spacer" />
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className="tab"
            data-active={view === t.key}
            onClick={() => onView(t.key)}
          >
            {view === t.key && (
              <motion.span
                layoutId="tab-indicator"
                className="tab-indicator"
                style={{ right: 4, inset: '4px 4px 4px 4px' }}
                transition={springs.spatialFast}
              />
            )}
            <Icon name={t.icon} />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <IconButton
        icon={s.resolvedDark ? 'light_mode' : 'dark_mode'}
        label="Theme wechseln"
        onClick={(e) => {
          // Keyboard activation reports clientX/Y = 0 — reveal from the button instead.
          const r = e.currentTarget.getBoundingClientRect()
          s.setTheme(s.resolvedDark ? 'light' : 'dark', {
            x: e.clientX || r.left + r.width / 2,
            y: e.clientY || r.top + r.height / 2,
          })
        }}
      />
      <IconButton icon="home" label="Startseite" onClick={onLanding} />
      <IconButton icon="keyboard" label="Shortcuts (?)" className="hide-mobile" onClick={onShortcuts} />
      <IconButton icon="settings" label="Einstellungen" onClick={() => onView('settings')} />
    </header>
  )
}
