import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { Choice, Placed } from '../lib/select'
import { nextIndex, placeMenu, typeAheadBuffer, typeAheadIndex } from '../lib/select'
import { prefersReducedMotion, springs } from '../lib/motion'
import { useBackDismiss } from '../state/overlays'
import { Icon } from './ui'

/**
 * Das Dropdown der App — dieselbe Sprache wie das Projekt-Menü im Detail-Dialog.
 *
 * cue hatte längst ein eigenes Dropdown (`.proj-menu`): getönte Fläche, Haken
 * an der gewählten Zeile, Feder beim Aufgehen. Die nativen `<select>` daneben
 * waren der Ausreißer — sie zeichnet das Betriebssystem, nicht die App. Diese
 * Komponente verallgemeinert das vorhandene Menü, sie erfindet keine zweite
 * Formensprache.
 *
 * ⚠️ Das Menü hängt in einem PORTAL am `body` und liegt `fixed`. Innerhalb des
 * Dialogs ginge es nicht: `.sheet` ist `overflow: hidden` und scrollt in einem
 * inneren Behälter — ein absolut gesetztes Menü am unteren Feld würde dort
 * abgeschnitten. Dafür muss es bei jedem Scrollen neu vermessen werden, was der
 * Rückruf unten tut.
 *
 * ⚠️ Der Fokus bleibt auf dem Auslöser (`aria-activedescendant`), er wandert
 * NICHT in die Liste. Damit bleibt `<label htmlFor>` wirksam, es braucht keine
 * Fokusfalle, und Escape muss nichts zurückgeben.
 */
export function Select<V extends string | number>({
  id,
  value,
  options,
  onChange,
  className = '',
  style,
  ariaLabel,
  placeholder = '— bitte wählen —',
  disabled,
  ...rest
}: {
  id?: string
  value: V
  options: Choice<V>[]
  onChange: (value: V) => void
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
} & Record<`data-${string}`, string | undefined>) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [placed, setPlaced] = useState<Placed & { left: number; width: number }>({
    top: 0, left: 0, width: 0, maxHeight: 0, placement: 'below',
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buffer = useRef({ text: '', at: 0 })
  const reduce = prefersReducedMotion()

  const gewaehlt = options.findIndex((o) => o.value === value)
  const aktuell = gewaehlt >= 0 ? options[gewaehlt] : null

  const schliessen = useCallback(() => setOpen(false), [])
  useBackDismiss(schliessen, open)

  /** Aufgehen heißt: auf der gewählten Zeile stehen. Das gehört in den
   *  Auslöser, nicht in einen Effekt — sonst setzte ein Neuzeichnen die
   *  Markierung zurück, während man gerade mit den Pfeilen navigiert. */
  const oeffnen = useCallback(() => {
    setHighlight(gewaehlt >= 0 ? gewaehlt : 0)
    setOpen(true)
  }, [gewaehlt])

  /** Neu vermessen — beim Aufgehen und bei jeder Bewegung darunter. */
  const vermessen = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Die natürliche Höhe der Liste, solange sie noch keine Deckelung hat.
    const wunsch = (listRef.current?.scrollHeight ?? 0) + 12
    setPlaced({ ...placeMenu(r, wunsch || 240, window.innerHeight), left: r.left, width: r.width })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    vermessen()
    let frame = 0
    const neu = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(vermessen)
    }
    // ⚠️ `capture`, damit auch das Scrollen INNERHALB des Dialogs ankommt —
    // ein Scroll-Ereignis an einem inneren Behälter steigt nicht auf.
    window.addEventListener('scroll', neu, true)
    window.addEventListener('resize', neu)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', neu, true)
      window.removeEventListener('resize', neu)
    }
  }, [open, vermessen, options.length])

  // Die markierte Zeile ins Bild holen.
  useEffect(() => {
    if (!open) return
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  // Klick daneben schließt. Auf dem Auslöser NICHT, sonst öffnete sein eigener
  // Klick das Menü direkt wieder.
  useEffect(() => {
    if (!open) return
    const aus = (e: PointerEvent) => {
      const ziel = e.target as Node
      if (triggerRef.current?.contains(ziel) || listRef.current?.contains(ziel)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', aus, true)
    return () => window.removeEventListener('pointerdown', aus, true)
  }, [open])

  function waehlen(i: number) {
    const o = options[i]
    if (!o) return
    onChange(o.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      // Geschlossen öffnen dieselben Tasten wie am nativen Feld.
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        oeffnen()
      }
      return
    }
    if (e.key === 'Escape') {
      // ⚠️ Nur das Menü schließen, nicht den Dialog darunter — das erledigt
      // sonst derselbe Tastendruck gleich mit.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      waehlen(highlight)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const ziel = nextIndex(highlight, e.key, options.length)
    if (ziel !== null) {
      e.preventDefault()
      setHighlight(ziel)
      return
    }
    // Sprungsuche: ein druckbares Zeichen, keine Tastenkürzel.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Die Zeit steht am Ereignis — kein unreiner Aufruf im Rumpf.
      buffer.current = typeAheadBuffer(buffer.current, e.key, e.timeStamp)
      const treffer = typeAheadIndex(
        options.map((o) => o.label),
        buffer.current.text,
        highlight,
      )
      if (treffer !== null) {
        e.preventDefault()
        setHighlight(treffer)
      }
    }
  }

  const menu = open && (
    <motion.ul
      ref={listRef}
      id={listId}
      role="listbox"
      className="cselect-menu"
      aria-activedescendant={`${listId}-${highlight}`}
      style={{
        top: placed.top,
        left: placed.left,
        minWidth: placed.width,
        maxHeight: placed.maxHeight,
      }}
      initial={reduce ? false : { opacity: 0, scale: 0.94, y: placed.placement === 'below' ? -4 : 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      transition={reduce ? { duration: 0 } : springs.spatialFast}
    >
      {options.map((o, i) => (
        <li
          key={String(o.value)}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={o.value === value}
          className="cselect-item"
          data-active={i === highlight}
          onPointerEnter={() => setHighlight(i)}
          onClick={() => waehlen(i)}
        >
          {o.dot && <span className="dot" style={{ background: o.dot }} />}
          {o.icon && <Icon name={o.icon} className={`cselect-icon ${o.iconClass ?? ''}`} />}
          <span className="cselect-label">{o.label}</span>
          {o.value === value && <Icon name="check" className="cselect-check" />}
        </li>
      ))}
    </motion.ul>
  )

  return (
    <>
      <button
        {...rest}
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`select cselect ${className}`.trim()}
        style={style}
        data-open={open}
        onClick={() => !disabled && (open ? setOpen(false) : oeffnen())}
        onKeyDown={onKeyDown}
      >
        {aktuell?.dot && <span className="dot" style={{ background: aktuell.dot }} />}
        {aktuell?.icon && (
          <Icon name={aktuell.icon} className={`cselect-icon ${aktuell.iconClass ?? ''}`} />
        )}
        <span className="cselect-value" data-empty={!aktuell}>
          {aktuell ? aktuell.label : placeholder}
        </span>
        <Icon name="expand_more" className="cselect-caret" />
      </button>
      {createPortal(<AnimatePresence>{menu}</AnimatePresence>, document.body)}
    </>
  )
}
