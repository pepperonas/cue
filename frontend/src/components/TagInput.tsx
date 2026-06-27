import { useMemo, useRef, useState } from 'react'

interface Props {
  id?: string
  value: string
  placeholder?: string
  suggestions: string[]
  onChange: (value: string) => void
}

const MAX_SUGGESTIONS = 8

// Split the raw comma-separated value into completed segments + the segment
// currently being typed (after the last comma).
function splitTags(value: string): { completed: string[]; current: string } {
  const parts = value.split(',')
  const current = parts.pop() ?? ''
  return { completed: parts, current }
}

/**
 * Comma-separated tag field with type-ahead suggestions. Completion applies to
 * the token after the last comma; picking one keeps the rest intact and leaves
 * the field ready for the next tag.
 */
export function TagInput({ id, value, placeholder, suggestions, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { completed, current } = splitTags(value)
  const query = current.trim().toLowerCase()

  const chosen = useMemo(
    () =>
      new Set(
        value
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    [value],
  )

  const matches = useMemo(() => {
    const pool = suggestions.filter((t) => !chosen.has(t.toLowerCase()))
    if (!query) return pool.slice(0, MAX_SUGGESTIONS)
    const starts = pool.filter((t) => t.toLowerCase().startsWith(query))
    const contains = pool.filter(
      (t) => !t.toLowerCase().startsWith(query) && t.toLowerCase().includes(query),
    )
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [suggestions, chosen, query])

  function commit(tag: string) {
    const next = [...completed.map((t) => t.trim()).filter(Boolean), tag]
    onChange(next.join(', ') + ', ')
    setOpen(true)
    setActive(0)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
      if (e.key === 'ArrowDown') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Only intercept Enter/Tab when actively typing a token to complete.
      if (e.key === 'Enter' && !query) return
      e.preventDefault()
      commit(matches[active] ?? matches[0])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="tag-input">
      <input
        id={id}
        ref={inputRef}
        className="input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="tag-suggest" role="listbox">
          {matches.map((tag, i) => (
            <li key={tag} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`tag-suggest-item ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                // mousedown fires before the input's blur, so the click lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(tag)
                }}
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
