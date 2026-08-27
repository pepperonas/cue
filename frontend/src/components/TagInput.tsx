import { useMemo, useRef, useState } from 'react'
import {
  inlineCompletion,
  rankSuggestions,
  type RankContext,
  type TagSuggestion,
} from '../lib/tags'
import { isHandled, tagKeyAction } from '../lib/tag-keys'
import { Icon } from './ui'
import { GhostOverlay, useGhostGuards } from './GhostOverlay'

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

const MAX_SUGGESTIONS = 8

const REASON_HINT = {
  title: 'Passt zum Titel',
  related: 'Wird oft zusammen verwendet',
} as const

// Split the raw comma-separated value into completed segments + the segment
// currently being typed (after the last comma).
function splitTags(value: string): { completed: string[]; current: string } {
  const parts = value.split(',')
  const current = parts.pop() ?? ''
  return { completed: parts, current }
}

/**
 * Comma-separated tag field with type-ahead.
 *
 * Two ways to end a tag, and they mean different things:
 *
 *   → / Tab            take the SUGGESTION (the grey completion, or the highlighted row)
 *   Enter / Space / ,  take WHAT I TYPED, verbatim, as its own tag
 *
 * That split is the point: the suggestion keys mean "yes, that word", the
 * literal keys mean "no, mine" — and neither has to be undone by the other.
 * (Before 0.46.0 Enter took the suggestion, so writing a tag the catalogue
 * already half-matched meant deleting what the field had just done for you.)
 * After either, the field is ready for the next tag and the menu re-opens, now
 * ranked by what the tag just added co-occurs with.
 *
 * ⚠️ The suggestion keys only fire while a token is actually being TYPED. With
 * an empty token the menu still lists tags, and binding Tab there would trap the
 * keyboard in this field: every commit re-opens the menu, so there would never
 * be a press that moves focus on.
 *
 * Space is a separator here, never a character: across 291 prompts and 20 tags
 * not one tag token contains a space (they are single-token, hyphenated).
 */
export function TagInput({ id, value, placeholder, suggestions, context, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [dropUp, setDropUp] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const ghost = useGhostGuards(inputRef, value, open)

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
  const query = current.trim()
  const typing = query.length > 0

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
  // substring, then context, then usage, then recency) so it can be unit tested.
  const matches = useMemo(
    () =>
      rankSuggestions(suggestions, query.toLowerCase(), {
        exclude: chosen,
        limit: MAX_SUGGESTIONS,
        context,
      }),
    [suggestions, chosen, query, context],
  )

  const suggestion = matches[active] ?? matches[0]
  // A trailing blank would put the ghost a space away from the word it completes.
  // Space commits, so this can only happen after a paste.
  const insert = /\s$/.test(value) ? null : inlineCompletion(query, suggestion?.name)
  const showGhost = open && ghost.ready && typing && !!insert

  function commit(tag: string) {
    const clean = tag.trim()
    if (!clean) return
    const kept = completed.map((t) => t.trim()).filter(Boolean)
    // Don't add a tag the prompt already has (case-insensitive).
    const next = kept.some((t) => t.toLowerCase() === clean.toLowerCase()) ? kept : [...kept, clean]
    onChange(next.join(', ') + ', ')
    setActive(0)
    inputRef.current?.focus()
    openMenu()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // The decision table lives in lib/tag-keys.ts so it can be tested; this
    // only carries it out.
    const action = tagKeyAction(e, {
      typing,
      menuOpen: open,
      hasSuggestion: matches.length > 0,
      caretAtEnd: ghost.atEnd,
    })
    if (!isHandled(action)) return
    e.preventDefault()
    switch (action) {
      case 'takeSuggestion':
        if (suggestion) commit(suggestion.name)
        break
      case 'takeTyped':
        commit(query)
        break
      case 'moveDown':
        setActive((i) => (i + 1) % matches.length)
        break
      case 'moveUp':
        setActive((i) => (i + matches.length - 1) % matches.length)
        break
      case 'openMenu':
        openMenu()
        break
      case 'closeMenu':
        // Without this the first Escape closed the whole composer.
        e.stopPropagation()
        setOpen(false)
        break
      case 'swallow':
        break
    }
  }

  return (
    <div className="tag-input">
      <input
        id={id}
        ref={inputRef}
        className="input ghost-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        // Both, now: a list below and a completion inside the field.
        aria-autocomplete="both"
        aria-describedby={showGhost ? `${id ?? 'tags'}-ghost-hint` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
          openMenu()
          ghost.syncCaret()
        }}
        onSelect={ghost.syncCaret}
        onKeyUp={ghost.syncCaret}
        onFocus={() => {
          openMenu()
          ghost.syncCaret()
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        {...ghost.compositionProps}
      />
      {showGhost && insert && (
        <>
          <GhostOverlay
            value={value}
            insert={insert}
            hint="→"
            hintTitle="Tab oder → übernimmt den Vorschlag · Enter, Leertaste oder Komma übernimmt das Getippte"
          />
          <span id={`${id ?? 'tags'}-ghost-hint`} className="sr-only">
            Vorschlag {suggestion?.name}. Mit Tab oder Pfeil rechts übernehmen; mit Enter,
            Leertaste oder Komma das Getippte als eigenes Tag speichern.
          </span>
        </>
      )}
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
