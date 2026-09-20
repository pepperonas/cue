// Das Modell einer Prompt-Karte — anzeigen UND ändern, ohne den Dialog.
//
// Kein eigenes Dropdown: `Select` ist bereits das Menü der App und bringt
// Portal (wird von `overflow` der Karte nicht abgeschnitten), feste
// Positionierung, Tastaturbedienung, Sprungsuche, Escape und Klick-daneben
// mit. Hier kommt nur das Aussehen eines Badges dazu — und die zwei Wächter,
// die eine Karte braucht.
import { modelOf, modelOptions, badgeLabel, isStale, KEIN_MODELL } from '../lib/models'
import type { AiModel } from '../lib/types'
import { Select } from './Select'

export function ModelBadge({
  models,
  value,
  onChange,
  compact = false,
  id,
}: {
  models: AiModel[]
  value: number | null
  onChange: (modelId: number | null) => void
  /** Kartenform: kleiner, ohne Pfeil im Ruhezustand. */
  compact?: boolean
  id?: string
}) {
  const aktuell = modelOf(models, value)
  return (
    // ⚠️ Die Wächter tun Verschiedenes, und der zweite muss am RICHTIGEN
    // Ereignis hängen: `onClick` verhindert, dass der Klick die Karte öffnet.
    // Gegen den Zug reicht `onPointerDown` NICHT — `useDragSensors` fährt
    // MouseSensor und TouchSensor, deren Auslöser `mousedown` bzw.
    // `touchstart` sind. Mit nur `pointerdown` hat ein Zug am Badge die Karte
    // wirklich verschoben (im Browser gemessen, nicht vermutet).
    <span
      className="model-badge-wrap"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <Select
        id={id}
        className={compact ? 'model-badge' : 'model-select'}
        value={aktuell ? aktuell.id : KEIN_MODELL}
        options={modelOptions(models, value)}
        onChange={(v) => onChange(v === KEIN_MODELL ? null : v)}
        ariaLabel={`Modell: ${badgeLabel(aktuell)}`}
        placeholder="Modell wählen"
        data-empty={aktuell ? undefined : 'true'}
        data-stale={isStale(aktuell) ? 'true' : undefined}
      />
    </span>
  )
}
