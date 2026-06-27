import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../lib/motion'
import { Icon } from './ui'

interface Props {
  active: boolean
  onToggle: () => void
  iconOn: string
  iconOff: string
  labelOn: string
  labelOff: string
  // Styling hook on the <button>; the active state also gets `.active`.
  baseClass: string
  variant?: 'mini-btn' | 'icon-btn'
}

/** Generic icon toggle: tints + fills when active and pops on each flip. */
export function ToggleIconButton({
  active,
  onToggle,
  iconOn,
  iconOff,
  labelOn,
  labelOff,
  baseClass,
  variant = 'mini-btn',
}: Props) {
  const reduce = prefersReducedMotion()
  const label = active ? labelOn : labelOff
  return (
    <button
      className={`${variant} ${baseClass} ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <motion.span
        // Remount on each flip so the entrance animation replays.
        key={active ? 'on' : 'off'}
        style={{ display: 'inline-flex' }}
        initial={reduce ? false : { scale: 0.3, rotate: active ? -20 : 0 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={reduce ? { duration: 0 } : springs.bouncy}
      >
        <Icon name={active ? iconOn : iconOff} />
      </motion.span>
    </button>
  )
}
