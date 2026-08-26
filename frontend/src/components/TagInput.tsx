import { useMemo, useRef, useState } from 'react'
import { rankSuggestions, type RankContext, type TagSuggestion } from '../lib/tags'
import { Icon } from './ui'

interface Props {
  id?: string
  value: string
  placeholder?: string
  /** Merged pool: saved vocabulary (with usage counts) + curated catalogue. */
  suggestions: TagSuggestion[]
  /**
   * What the prompt implies regardless of what is typed — tags the title points
   * at, and tags that go with the ones already picked. Only ever breaks ties
   * between equally good matches, so typing still decides.
   */
  context?: RankContext
  onChange: (value: string) => void
}

const REASON_HINT = {
  title: 'Passt zum Titel',
  related: 'Wird oft zusammen verwendet',
} as const

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
export function TagInput({ id, value, placeholder, suggestions, context, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [dropUp, setDropUp] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Open above the field when there isn't enough room below (the tag field sits
  // near the bottom of the dialog, so dropping down would cover the actions).
  function recalcDirection() {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom
    setDropUp(spaceBelow < 220 && rect.top > spaceBelow)
  }

  function openMenu() {
    recalcDirection()
    setOpen(true)
  }

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

  // Relevance ranking lives in lib/tags.ts (exact > prefix > word-start >
  // substring, then usage, then recency) so it can be unit tested.
  const matches = useMemo(
    () => rankSuggestions(suggestions, query, { exclude: chosen, limit: MAX_SUGGESTIONS, context }),
    [suggestions, chosen, query, context],
  )

  function commit(tag: string) {
    const kept = completed.map((t) => t.trim()).filter(Boolean)
    // Don't add a tag the prompt already has (case-insensitive).
    const next = kept.some((t) => t.toLowerCase() === tag.toLowerCase())
      ? kept
      : [...kept, tag]
    onChange(next.join(', ') + ', ')
    setActive(0)
    inputRef.current?.focus()
    openMenu()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
      if (e.key === 'ArrowDown') {
        openMenu()
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
      commit((matches[active] ?? matches[0]).name)
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
          setActive(0)
          openMenu()
        }}
        onFocus={openMenu}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className={`tag-suggest ${dropUp ? 'up' : ''}`} role="listbox">
          {matches.map((tag, i) => (
            <li key={tag.name} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`tag-suggest-item ${i === active ? 'active' : ''} ${
                  tag.reason ? 'tag-suggest-item--context' : ''
                }`}
                title={tag.reason ? REASON_HINT[tag.reason] : undefined}
                onMouseEnter={() => setActive(i)}
                // mousedown fires before the input's blur, so the click lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(tag.name)
                }}
              >
                <span className="tag-suggest-name">
                  {tag.reason && (
                    <Icon
                      name={tag.reason === 'title' ? 'auto_awesome' : 'link'}
                      className="tag-suggest-why"
                    />
                  )}
                  #{tag.name}
                </span>
                {tag.usage > 0 ? (
                  <span className="tag-suggest-meta" title={`${tag.usage}× verwendet`}>
                    {tag.usage}×
                  </span>
                ) : (
                  <span className="tag-suggest-meta tag-suggest-meta--new">
                    {tag.source === 'catalog' ? 'Katalog' : 'neu'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
