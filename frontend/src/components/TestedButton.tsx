import { ToggleIconButton } from './ToggleIconButton'

interface Props {
  tested: boolean
  onToggle: () => void
  variant?: 'mini-btn' | 'icon-btn'
}

/** "Feature tested?" toggle — green fill + highlight when marked tested.
 *  Only meaningful for running/done prompts (the caller gates rendering). */
export function TestedButton({ tested, onToggle, variant }: Props) {
  return (
    <ToggleIconButton
      active={tested}
      onToggle={onToggle}
      iconOn="verified"
      iconOff="verified"
      labelOn="Als ungetestet markieren"
      labelOff="Als getestet markieren"
      baseClass="tested-btn"
      variant={variant}
    />
  )
}
