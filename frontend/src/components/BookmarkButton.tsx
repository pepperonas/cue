import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../lib/motion'
import { Icon } from './ui'

interface Props {
  bookmarked: boolean
  onToggle: () => void
  // 'mini-btn' on cards/list rows, 'icon-btn' in the detail header.
  variant?: 'mini-btn' | 'icon-btn'
}

/** Bookmark toggle that fills + tints gold when active and pops on toggle. */
export function BookmarkButton({ bookmarked, onToggle, variant = 'mini-btn' }: Props) {
  const reduce = prefersReducedMotion()
  const label = bookmarked ? 'Bookmark entfernen' : 'Bookmarken'
  return (
    <button
      className={`${variant} bookmark-btn ${bookmarked ? 'bookmarked' : ''}`}
      aria-label={label}
      aria-pressed={bookmarked}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <motion.span
        // Remount on each state flip so the entrance animation replays.
        key={bookmarked ? 'on' : 'off'}
        style={{ display: 'inline-flex' }}
        initial={reduce ? false : { scale: 0.3, rotate: bookmarked ? -20 : 0 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={reduce ? { duration: 0 } : springs.bouncy}
      >
        <Icon name={bookmarked ? 'bookmark' : 'bookmark_border'} />
      </motion.span>
    </button>
  )
}
