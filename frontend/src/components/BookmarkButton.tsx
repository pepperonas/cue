import { ToggleIconButton } from './ToggleIconButton'

interface Props {
  bookmarked: boolean
  onToggle: () => void
  variant?: 'mini-btn' | 'icon-btn'
}

/** Bookmark toggle — gold fill + highlight when active. */
export function BookmarkButton({ bookmarked, onToggle, variant }: Props) {
  return (
    <ToggleIconButton
      active={bookmarked}
      onToggle={onToggle}
      iconOn="bookmark"
      iconOff="bookmark_border"
      labelOn="Bookmark entfernen"
      labelOff="Bookmarken"
      baseClass="bookmark-btn"
      variant={variant}
    />
  )
}
