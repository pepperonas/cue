import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * The inline-suggestion overlay shared by the title field and the tag field.
 *
 * It paints NOTHING where the user's own text is (that span is transparent) and
 * carries no background of its own, so the input keeps its fill and its caret
 * stays visible through the layer. Geometry lives in `.ghost-layer` and mirrors
 * `.input:focus` exactly — both fields are `.input`, so one set of numbers fits
 * both.
 */
export function GhostOverlay({
  value,
  insert,
  hint,
  hintTitle,
}: {
  value: string
  insert: string
  /** The key that takes it — a suggestion nobody knows how to accept is decoration. */
  hint: string
  hintTitle?: string
}) {
  return (
    <>
      <div className="ghost-layer" aria-hidden="true">
        <span className="ghost-typed">{value}</span>
        <span className="ghost-rest">{insert}</span>
      </div>
      <span className="ghost-key" aria-hidden="true" title={hintTitle}>
        {hint}
      </span>
    </>
  )
}

/**
 * The three conditions under which an aligned overlay is honest, plus the caret
 * tracking both fields need anyway.
 *
 * `ready` is false while an IME composition is open (the field holds provisional
 * text), while the caret sits anywhere but the end (a ghost in the middle of a
 * word is nonsense), and once the value outgrows the field — an input that
 * scrolls drifts out of register with the overlay, and a misaligned ghost is
 * worse than none.
 */
export function useGhostGuards(
  inputRef: RefObject<HTMLInputElement | null>,
  value: string,
  focused: boolean,
) {
  const [atEnd, setAtEnd] = useState(true)
  const [composing, setComposing] = useState(false)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    // Focus is a dependency because `.input:focus` swaps 1px border + 12px
    // padding for 2px + 11px, which moves clientWidth.
    setOverflow(el.scrollWidth > el.clientWidth + 1)
  }, [inputRef, value, focused])

  function syncCaret() {
    const el = inputRef.current
    if (!el) return
    setAtEnd(el.selectionStart === el.value.length && el.selectionEnd === el.value.length)
  }

  return {
    ready: atEnd && !composing && !overflow,
    atEnd,
    syncCaret,
    /** Spread onto the input. */
    compositionProps: {
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => setComposing(false),
    },
  }
}
