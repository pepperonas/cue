import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { IconButton } from './ui'

const SHORTCUTS: [string, string][] = [
  ['n', 'Neuer Prompt'],
  ['/', 'Suche fokussieren'],
  ['c', 'Fokussierten Prompt kopieren'],
  ['j / k', 'Navigieren'],
  ['e', 'Bearbeiten'],
  ['1 / 2 / 3', 'Status: Queued / Running / Done'],
  ['Enter', 'Detail öffnen'],
  ['?', 'Diese Übersicht'],
  ['Esc', 'Schließen'],
]

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={springs.bouncy}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Tastatur-Shortcuts</h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>
        <div className="shortcuts">
          {SHORTCUTS.map(([key, desc]) => (
            <div className="shortcut-row" key={key}>
              <kbd>{key}</kbd>
              <span className="muted">{desc}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
