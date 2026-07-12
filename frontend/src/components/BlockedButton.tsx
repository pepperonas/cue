import { ToggleIconButton } from './ToggleIconButton'

interface Props {
  blocked: boolean
  onToggle: () => void
  variant?: 'mini-btn' | 'icon-btn'
}

/** Blocked toggle — red tint when active; blocked prompts sink to the bottom
 * of their column and refuse running/done until unblocked. */
export function BlockedButton({ blocked, onToggle, variant }: Props) {
  return (
    <ToggleIconButton
      active={blocked}
      onToggle={onToggle}
      iconOn="block"
      iconOff="block"
      labelOn="Blockierung aufheben"
      labelOff="Blockieren"
      baseClass="blocked-btn"
      variant={variant}
    />
  )
}
