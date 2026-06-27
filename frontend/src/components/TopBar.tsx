import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { useSettings } from '../state/settings'
import { Icon, IconButton } from './ui'

export type View = 'board' | 'list' | 'bookmarks' | 'projects' | 'settings'

const TABS: { key: View; icon: string; label: string }[] = [
  { key: 'board', icon: 'view_kanban', label: 'Board' },
  { key: 'list', icon: 'list', label: 'Liste' },
  { key: 'bookmarks', icon: 'bookmark', label: 'Bookmarks' },
  { key: 'projects', icon: 'folder', label: 'Projekte' },
]

export function TopBar({
  view,
  onView,
  onShortcuts,
}: {
  view: View
  onView: (v: View) => void
  onShortcuts: () => void
}) {
  const s = useSettings()
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">
          <Icon name="bolt" />
        </span>
        cue
      </div>
      <div className="topbar-spacer" />
      <nav className="tabs">
        {TABS.map((t) => (
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
        onClick={() => s.setTheme(s.resolvedDark ? 'light' : 'dark')}
      />
      <IconButton icon="keyboard" label="Shortcuts (?)" onClick={onShortcuts} />
      <IconButton icon="settings" label="Einstellungen" onClick={() => onView('settings')} />
    </header>
  )
}
