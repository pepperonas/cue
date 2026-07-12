import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { Button, Icon } from './ui'

interface Props {
  title: string
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  icon?: string
  // Return an error message to keep the dialog open (e.g. duplicate name),
  // or null/undefined to accept. May be async (server round-trip).
  validate?: (value: string) => string | null | undefined
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

/** MD3 text-input dialog — replaces window.prompt() everywhere (project
 * convention: never use native browser dialogs). */
export function InputDialog({
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'OK',
  icon,
  validate,
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Bitte einen Wert eingeben')
      return
    }
    const problem = validate?.(trimmed)
    if (problem) {
      setError(problem)
      return
    }
    await onConfirm(trimmed)
  }

  return (
    <div className="scrim" onClick={onCancel}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={springs.bouncy}
      >
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        <div className="field" style={{ marginTop: 4 }}>
          <label htmlFor="input-dialog-field">{label}</label>
          <input
            id="input-dialog-field"
            ref={inputRef}
            className={`input ${error ? 'invalid' : ''}`}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <p className="error" style={{ marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>
        <div className="row-end">
          <Button variant="text" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button icon="check" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
