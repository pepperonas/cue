import { ToggleIconButton } from './ToggleIconButton'

/**
 * "Genau testen" — a done prompt that wants a thorough look before it counts.
 *
 * Binary on purpose, unlike the three-level priority it replaces in this slot:
 * either the work needs that careful pass or it does not, and a middle value
 * would only invite deliberation about a note.
 *
 * Same glyph in both states — a bare `!` has no outline variant, and the
 * colour is what carries the state (see `.close-test-btn` in global.css). That
 * is the pattern `TestedButton` already uses.
 */
export function CloseTestButton({
  marked,
  onToggle,
  variant = 'mini-btn',
}: {
  marked: boolean
  onToggle: () => void
  variant?: 'mini-btn' | 'icon-btn'
}) {
  return (
    <ToggleIconButton
      active={marked}
      onToggle={onToggle}
      iconOn="priority_high"
      iconOff="priority_high"
      labelOn="Genau testen — Markierung entfernen"
      labelOff="Für genaues Testen markieren"
      baseClass="close-test-btn"
      variant={variant}
    />
  )
}
