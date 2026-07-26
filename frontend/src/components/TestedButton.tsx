import { ToggleIconButton } from './ToggleIconButton'

interface Props {
  tested: boolean
  onToggle: () => void
  variant?: 'mini-btn' | 'icon-btn'
  disabled?: boolean
}

/** "Feature tested?" toggle — green fill + highlight when marked tested.
 *  Rendered for running/done prompts (the caller gates that), but only
 *  ENABLED on done ones — on running it shows grayed out. */
export function TestedButton({ tested, onToggle, variant, disabled }: Props) {
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
      disabled={disabled}
      disabledLabel="Nur erledigte Prompts können als getestet markiert werden"
    />
  )
}
