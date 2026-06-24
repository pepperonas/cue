import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { Button } from './ui'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function Confirm({ title, message, confirmLabel = 'Löschen', onConfirm, onCancel }: Props) {
  return (
    <div className="scrim" onClick={onCancel}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={springs.bouncy}
      >
        <h2>{title}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {message}
        </p>
        <div className="row-end">
          <Button variant="text" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button variant="danger" icon="delete" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
