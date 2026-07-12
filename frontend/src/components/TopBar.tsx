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
  | 'projects'
  | 'settings'

const TABS: { key: View; icon: string; label: string }[] = [
  { key: 'board', icon: 'view_kanban', label: 'Board' },
  { key: 'list', icon: 'list', label: 'Liste' },
  { key: 'bookmarks', icon: 'bookmark', label: 'Bookmarks' },
  { key: 'runs', icon: 'play_arrow', label: 'Runs' },
  { key: 'sessions', icon: 'history', label: 'Verlauf' },
  { key: 'projects', icon: 'folder', label: 'Projekte' },
]

export function TopBar({
  view,
  onView,
  onShortcuts,
  canRun = false,
  projectLabel = null,
}: {
  view: View
  onView: (v: View) => void
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
        <span className="logo">
          <Icon name="bolt" />
        </span>
        <span className="brand-name">cue</span>
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
      <IconButton icon="keyboard" label="Shortcuts (?)" onClick={onShortcuts} />
      <IconButton icon="settings" label="Einstellungen" onClick={() => onView('settings')} />
    </header>
  )
}
