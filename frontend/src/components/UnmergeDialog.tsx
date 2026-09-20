import { useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import type { Prompt } from '../lib/types'
import { useBackDismiss } from '../state/overlays'
import { Button, Icon } from './ui'

export type MergedFate = 'delete' | 'archive' | 'keep'

/** Dieselben drei Möglichkeiten wie im Zusammenführen-Dialog, nur andersherum
 *  gefragt — dieselbe Frage verdient dasselbe Vokabular. */
const FATES: { key: MergedFate; icon: string; label: string }[] = [
  { key: 'delete', icon: 'delete', label: 'Löschen' },
  { key: 'archive', icon: 'inventory_2', label: 'Archivieren' },
  { key: 'keep', icon: 'content_copy', label: 'Behalten' },
]

/**
 * Ein Zusammenführen wieder auftrennen.
 *
 * Die Quellen kommen aus dem Abbild zurück, das beim Zusammenführen entstanden
 * ist. Zu entscheiden bleibt nur, was mit dem zusammengeführten Prompt
 * geschieht — und das ist eine echte Frage: wer nach dem Zusammenführen eine
 * Woche daran gearbeitet hat, will ihn behalten.
 */
export function UnmergeDialog({
  prompt,
  onClose,
  onConfirm,
  busy,
}: {
  prompt: Prompt
  onClose: () => void
  onConfirm: (fate: MergedFate) => void
  busy?: boolean
}) {
  const [fate, setFate] = useState<MergedFate>('delete')
  useBackDismiss(onClose)

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={springs.spatialFast}
      >
        <h3>Zusammenführen auftrennen</h3>
        <p className="muted" style={{ margin: 0 }}>
          {prompt.merged_from} Prompts kommen so zurück, wie sie beim Zusammenführen waren — mit
          Projekt, Schlagworten, Priorität und Screenshots. Quellen, die damals behalten oder
          archiviert wurden, werden dabei nicht doppelt angelegt.
        </p>

        <div className="field">
          <label>Mit dem zusammengeführten Prompt</label>
          <div className="row" style={{ gap: 'var(--gap-2)', flexWrap: 'wrap' }}>
            {FATES.map((f) => (
              <button
                key={f.key}
                className="chip"
                data-active={fate === f.key}
                onClick={() => setFate(f.key)}
              >
                <Icon name={f.icon} /> {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="call_split" onClick={() => onConfirm(fate)} disabled={busy}>
            {busy ? 'Wird getrennt…' : 'Auftrennen'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
