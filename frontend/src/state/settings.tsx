import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { applyScheme, buildSchemes } from '../lib/color'

type ThemeMode = 'light' | 'dark' | 'system'

interface Settings {
  theme: ThemeMode
  seed: string
  copyAdvancesStatus: boolean
}

interface SettingsCtx extends Settings {
  resolvedDark: boolean
  setTheme: (t: ThemeMode) => void
  setSeed: (s: string) => void
  setCopyAdvancesStatus: (v: boolean) => void
}

const DEFAULTS: Settings = {
  theme: 'system',
  seed: '#6750A4',
  copyAdvancesStatus: false,
}

const Ctx = createContext<SettingsCtx | null>(null)

function load(): Settings {
  return {
    theme: (localStorage.getItem('cue-theme') as ThemeMode) || DEFAULTS.theme,
    seed: localStorage.getItem('cue-seed') || DEFAULTS.seed,
    copyAdvancesStatus: localStorage.getItem('cue-copy-advances') === '1',
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedDark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark)

  // Apply theme + dynamic color whenever they change.
  useEffect(() => {
    const schemes = buildSchemes(settings.seed)
    applyScheme(resolvedDark ? schemes.dark : schemes.light)
    document.documentElement.dataset.theme = resolvedDark ? 'dark' : 'light'
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', schemes[resolvedDark ? 'dark' : 'light'].surface)
  }, [settings.seed, resolvedDark])

  const value = useMemo<SettingsCtx>(
    () => ({
      ...settings,
      resolvedDark,
      setTheme: (theme) => {
        localStorage.setItem('cue-theme', theme)
        setSettings((s) => ({ ...s, theme }))
      },
      setSeed: (seed) => {
        localStorage.setItem('cue-seed', seed)
        document.documentElement.style.setProperty('--seed', seed)
        setSettings((s) => ({ ...s, seed }))
      },
      setCopyAdvancesStatus: (v) => {
        localStorage.setItem('cue-copy-advances', v ? '1' : '0')
        setSettings((s) => ({ ...s, copyAdvancesStatus: v }))
      },
    }),
    [settings, resolvedDark],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings outside provider')
  return ctx
}
