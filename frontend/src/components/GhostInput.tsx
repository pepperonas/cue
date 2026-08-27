import { useMemo, useRef, useState } from 'react'
import {
  acceptCompletion,
  completeTitle,
  type Completion,
  type TitleModel,
} from '../lib/title-complete'
import { GhostOverlay, useGhostGuards } from './GhostOverlay'

interface Props {
  id?: string
  value: string
  placeholder?: string
  /** Completion source, built from the titles written before. */
  model: TitleModel
  onChange: (value: string) => void
}

/**
 * Text field with an inline suggestion ("ghost text") for the next word.
 *
 * Keys follow the two conventions that do not collide with a form: Enter takes
 * the shown word — one word per press, so the sentence can be steered — and →
 * at the end of the field does the same (fish/zsh autosuggest muscle memory).
 * Tab deliberately stays focus navigation: this is a dialog field, not an
 * editor, and stealing Tab would strand keyboard users in it. Escape dismisses
 * the suggestion without closing the dialog.
 *
 * The value is never touched until the user accepts, so what the field holds is
 * always exactly what they typed.
 */
export function GhostInput({ id, value, placeholder, model, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  // Caret / IME / overflow guards are shared with the tag field.
  const ghost = useGhostGuards(inputRef, value, focused)
  // Escape hides the suggestion for the value it was shown for — typing anything
  // brings suggestions back. Remembering the VALUE instead of a boolean means no
  // effect has to reset it, and there is no moment where the two disagree.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const dismissed = dismissedFor === value

  const completion = useMemo(() => completeTitle(model, value), [model, value])

  const visible = !!completion && focused && ghost.ready && !dismissed

  function accept(c: Completion) {
    const next = acceptCompletion(value, c)
    onChange(next)
    // The caret has to land after the inserted text, or the follow-up
    // suggestion would be judged "not at the end" and never appear.
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.setSelectionRange(next.length, next.length)
      ghost.syncCaret()
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible || !completion) return
    if (e.key === 'Enter' || (e.key === 'ArrowRight' && ghost.atEnd)) {
      // Cmd/Ctrl+Enter is the save shortcut and must keep working.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      accept(completion)
    } else if (e.key === 'Escape') {
      // Without this the dialog itself would close on the first Escape.
      e.preventDefault()
      e.stopPropagation()
      setDismissedFor(value)
    }
  }

  return (
    <div className="ghost-field">
      <input
        id={id}
        ref={inputRef}
        className="input ghost-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        // The ARIA value for exactly this: a completion inside the field.
        aria-autocomplete="inline"
        aria-describedby={visible ? `${id ?? 'ghost'}-hint` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          ghost.syncCaret()
        }}
        onSelect={ghost.syncCaret}
        onKeyUp={ghost.syncCaret}
        onFocus={() => {
          setFocused(true)
          ghost.syncCaret()
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        {...ghost.compositionProps}
      />
      {visible && completion && (
        <>
          <GhostOverlay
            value={value}
            insert={completion.insert}
            hint="↵"
            hintTitle="Enter übernimmt das nächste Wort"
          />
          <span id={`${id ?? 'ghost'}-hint`} className="sr-only">
            Vorschlag {completion.word}. Mit Enter Wort für Wort übernehmen.
          </span>
        </>
      )}
    </div>
  )
}
