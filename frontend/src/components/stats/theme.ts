// Chart theming: Recharts needs concrete colour strings for SVG attributes,
// while cue's palette lives in runtime CSS custom properties (`--md-*`, derived
// from the user's seed colour). This hook resolves them once per theme change
// so every chart in the dashboard shares one palette and follows dark/light
// mode plus the seed picker without a second source of truth.
import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../state/settings'

export interface ChartTheme {
  primary: string
  secondary: string
  tertiary: string
  error: string
  outline: string
  grid: string
  text: string
  textDim: string
  surface: string
  /** Categorical series colours, ordered for maximum separation. */
  palette: string[]
  /** Shared props for Recharts' <Tooltip>. */
  tooltip: {
    contentStyle: React.CSSProperties
    labelStyle: React.CSSProperties
    itemStyle: React.CSSProperties
    cursor: { fill: string } | { stroke: string; strokeWidth: number }
  }
}

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function useChartTheme(): ChartTheme {
  const settings = useSettings()
  // Re-read after the theme/seed has been applied to :root.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setTick((t) => t + 1))
    return () => cancelAnimationFrame(id)
  }, [settings.resolvedDark, settings.seed])

  return useMemo(() => {
    const primary = readVar('--md-primary', '#b3c5ff')
    const secondary = readVar('--md-secondary', '#c0c6dc')
    const tertiary = readVar('--md-tertiary', '#e3bada')
    const error = readVar('--md-error', '#ffb4ab')
    const outline = readVar('--md-outline', '#8f909a')
    const text = readVar('--md-on-surface', '#e5e1e9')
    const textDim = readVar('--md-on-surface-variant', '#c8c5d0')
    const surface = readVar('--md-surface-container-high', '#2b2930')
    return {
      primary,
      secondary,
      tertiary,
      error,
      outline,
      grid: `color-mix(in srgb, ${outline} 24%, transparent)`,
      text,
      textDim,
      surface,
      palette: [primary, tertiary, secondary, error, outline],
      tooltip: {
        contentStyle: {
          background: surface,
          border: `1px solid color-mix(in srgb, ${outline} 40%, transparent)`,
          borderRadius: 14,
          boxShadow: '0 8px 24px rgba(0,0,0,.28)',
          padding: '8px 12px',
          fontSize: 13,
        },
        labelStyle: { color: textDim, fontWeight: 600, marginBottom: 2 },
        itemStyle: { color: text, padding: 0 },
        cursor: { fill: `color-mix(in srgb, ${outline} 14%, transparent)` },
      },
    }
    // `tick` intentionally drives the recompute after a theme flip.
  }, [tick, settings.resolvedDark, settings.seed])
}

/** Status colours reused by the donut and the board tints. */
export const STATUS_COLORS: Record<string, string> = {
  queued: '#9aa5c4',
  running: '#f5c469',
  done: '#7fd1a0',
  failed: '#ff9d92',
  archived: '#8f909a',
}

export const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  archived: 'Archiviert',
}

// Recharts' formatter signatures are intentionally wide (`ValueType | undefined`).
// These wrappers take `unknown` — assignable to any of them — so chart call
// sites stay readable instead of repeating casts.
export function unitFormatter(
  unit: string,
  transform?: (value: number) => string,
): (value: unknown) => [string, string] {
  return (value) => [transform ? transform(Number(value)) : String(value ?? ''), unit]
}

export function statusFormatter(value: unknown, name: unknown): [string, string] {
  const key = String(name ?? '')
  return [String(value ?? ''), STATUS_LABELS[key] ?? key]
}

export function hourLabelFormatter(label: unknown): string {
  return `${String(label ?? '')}:00 Uhr`
}
