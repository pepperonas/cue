// Diff model for the optimization view: jsdiff (BSD-3, battle-tested) does the
// LCS work, this module turns its change list into the row/segment structure
// the GitHub-style renderer draws. Kept pure so it can be unit tested without a
// DOM.
import { diffLines, diffWordsWithSpace } from 'diff'

export type DiffKind = 'added' | 'removed' | 'unchanged'

/** One word-level piece inside a line — drives the inline highlight. */
export interface DiffSegment {
  kind: DiffKind
  value: string
}

export interface DiffRow {
  kind: DiffKind
  /** Line numbers in the original / optimized text (null where absent). */
  left: number | null
  right: number | null
  text: string
  /** Word-level detail; only filled for lines that were rewritten. */
  segments?: DiffSegment[]
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

function endWithNewline(text: string): string {
  const value = text ?? ''
  if (!value) return ''
  return value.endsWith('\n') ? value : `${value}\n`
}

function splitLines(text: string): string[] {
  const lines = (text ?? '').split('\n')
  // A trailing newline produces an empty last element — not a real line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Line diff with word-level detail on replaced blocks.
 *
 * jsdiff reports a rewrite as a removed block directly followed by an added
 * one; pairing those up line by line is what makes the inline highlight
 * possible instead of just "whole line red / whole line green".
 */
export function buildDiff(original: string, optimized: string): {
  rows: DiffRow[]
  stats: DiffStats
} {
  // Both sides get a trailing newline first: without it jsdiff cannot align the
  // last line and collapses a one-line change into one big block.
  const changes = diffLines(endWithNewline(original), endWithNewline(optimized))
  const rows: DiffRow[] = []
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 }
  let left = 0
  let right = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const lines = splitLines(change.value)

    if (change.removed) {
      const next = changes[i + 1]
      const addedLines = next?.added ? splitLines(next.value) : []
      lines.forEach((line, index) => {
        const counterpart = addedLines[index]
        rows.push({
          kind: 'removed',
          left: ++left,
          right: null,
          text: line,
          segments: counterpart !== undefined ? wordSegments(line, counterpart, 'removed') : undefined,
        })
        stats.removed++
      })
      if (next?.added) {
        addedLines.forEach((line, index) => {
          const counterpart = lines[index]
          rows.push({
            kind: 'added',
            left: null,
            right: ++right,
            text: line,
            segments: counterpart !== undefined ? wordSegments(counterpart, line, 'added') : undefined,
          })
          stats.added++
        })
        i++ // the paired added block is consumed
      }
      continue
    }

    if (change.added) {
      lines.forEach((line) => {
        rows.push({ kind: 'added', left: null, right: ++right, text: line })
        stats.added++
      })
      continue
    }

    lines.forEach((line) => {
      rows.push({ kind: 'unchanged', left: ++left, right: ++right, text: line })
      stats.unchanged++
    })
  }
  return { rows, stats }
}

/** Word-level segments of one line, keeping only the side we render. */
export function wordSegments(before: string, after: string, side: 'added' | 'removed'): DiffSegment[] {
  const parts = diffWordsWithSpace(before, after)
  const segments: DiffSegment[] = []
  for (const part of parts) {
    if (part.added && side === 'removed') continue
    if (part.removed && side === 'added') continue
    segments.push({
      kind: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
      value: part.value,
    })
  }
  return segments
}

/** Collapse long unchanged stretches, keeping `context` lines around changes. */
export function collapseUnchanged(rows: DiffRow[], context = 3): (DiffRow | { gap: number })[] {
  const keep = new Set<number>()
  rows.forEach((row, index) => {
    if (row.kind === 'unchanged') return
    for (let i = index - context; i <= index + context; i++) {
      if (i >= 0 && i < rows.length) keep.add(i)
    }
  })
  if (keep.size === rows.length) return rows
  const out: (DiffRow | { gap: number })[] = []
  let gap = 0
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (gap) {
        out.push({ gap })
        gap = 0
      }
      out.push(row)
    } else {
      gap++
    }
  })
  if (gap) out.push({ gap })
  return out
}

export function isGap(entry: DiffRow | { gap: number }): entry is { gap: number } {
  return 'gap' in entry
}
