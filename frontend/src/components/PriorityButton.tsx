import { motion } from 'motion/react'
import { prefersReducedMotion, springs } from '../lib/motion'
import { PRIORITY_ICON, PRIORITY_LABEL, type Priority } from '../lib/types'
import { priorityAfterPress } from '../lib/order'
import { usePress } from '../state/long-press'
import { Icon } from './ui'

interface Props {
  priority: Priority
  onChange: (next: Priority) => void
  variant?: 'mini-btn' | 'icon-btn'
}

/**
 * Three-state priority toggle for cards and list rows.
 *
 * A cycle rather than a menu: on a card the control has to fit next to five
 * others, and a popover for three values costs two interactions where one
 * does. The detail sheet offers the same three as a real dropdown, which is
 * where picking a specific level directly belongs.
 *
 * **Halten führt zurück auf „mittel".** Der Zyklus ist bequem, taugt aber
 * schlecht zum Zurücknehmen: von „hoch" auf den Standard führt er durch
 * „gering" hindurch, also über einen Zustand, den man gerade nicht meint.
 * Nichts davon ist exklusiv — die Auswahlliste im Detail-Dialog erreicht alle
 * drei Stufen direkt und bleibt der Weg für Tastatur und Screenreader.
 */
export function PriorityButton({ priority, onChange, variant = 'mini-btn' }: Props) {
  const reduce = prefersReducedMotion()
  const next = priorityAfterPress(priority, 'tap')!
  const held = priorityAfterPress(priority, 'hold')
  // Sagt, was er IST und was beide Gesten tun — ein Zyklus, dessen nächster
  // Schritt geraten werden muss, ist schlechter als ein Menü. Beides kommt aus
  // derselben Quelle wie die Aktion, Beschriftung und Verhalten können also
  // nicht auseinanderlaufen. ⚠️ Der Hinweis aufs Halten erscheint nur, wo es
  // etwas ANDERES tut als der Klick: auf „gering" führen beide Gesten nach
  // „mittel", und „klicken für Mittel · lange drücken für Mittel" sagt dasselbe
  // zweimal (so im Browser gesehen).
  const zeigeHalten = held !== null && held !== next
  const label =
    `Priorität: ${PRIORITY_LABEL[priority]} — klicken für ${PRIORITY_LABEL[next]}` +
    (zeigeHalten ? ` · lange drücken für ${PRIORITY_LABEL[held]}` : '')
  const press = usePress({
    onTap: () => onChange(next),
    // `held` ist null, sobald der Prompt schon „mittel" ist — dann bleibt der
    // Schreibvorgang aus, der Klick wird aber trotzdem geschluckt (sonst
    // machte ein Halten den Prompt dringend, das Gegenteil der Absicht).
    onHold: () => {
      if (held) onChange(held)
    },
  })
  return (
    <button
      className={`${variant} prio-btn`}
      data-prio={priority}
      aria-label={label}
      title={label}
      {...press}
    >
      <motion.span
        // Remount per level so the change is visible, not just different.
        key={priority}
        style={{ display: 'inline-flex' }}
        initial={reduce ? false : { scale: 0.3, y: priority === 'high' ? 6 : -6 }}
        animate={{ scale: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : springs.bouncy}
      >
        <Icon name={PRIORITY_ICON[priority]} />
      </motion.span>
    </button>
  )
}

/** The same three levels as a real dropdown — for the detail sheet. */
export function PrioritySelect({
  priority,
  onChange,
  id,
}: {
  priority: Priority
  onChange: (next: Priority) => void
  id?: string
}) {
  return (
    <select
      id={id}
      className="select select--prio"
      data-prio={priority}
      value={priority}
      aria-label="Priorität"
      onChange={(e) => onChange(e.target.value as Priority)}
    >
      {/* Urgent first: the list reads top-down like the queue it orders. */}
      <option value="high">Hoch</option>
      <option value="normal">Mittel</option>
      <option value="low">Gering</option>
    </select>
  )
}
