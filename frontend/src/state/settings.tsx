import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { applyScheme, buildSchemes } from '../lib/color'
import { prefersReducedMotion } from '../lib/motion'

type ThemeMode = 'light' | 'dark' | 'system'

interface Settings {
  theme: ThemeMode
  seed: string
  copyAdvancesStatus: boolean
}

interface SettingsCtx extends Settings {
  resolvedDark: boolean
  setTheme: (t: ThemeMode, origin?: { x: number; y: number }) => void
  setSeed: (s: string) => void
  setCopyAdvancesStatus: (v: boolean) => void
}

const DEFAULTS: Settings = {
  theme: 'system',
  seed: '#6750A4',
  copyAdvancesStatus: false,
}

const Ctx = createContext<SettingsCtx | null>(null)

// Apply theme + dynamic color to the document. Kept outside React so the
// view-transition callback can flip the theme synchronously (the new-state
// snapshot is taken right after the callback returns).
function applyDom(dark: boolean, seed: string) {
  const schemes = buildSchemes(seed)
  applyScheme(dark ? schemes.dark : schemes.light)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', schemes[dark ? 'dark' : 'light'].surface)
}

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

  // Apply theme + dynamic color whenever they change (idempotent — the
  // animated toggle below already applied the same values synchronously).
  useEffect(() => {
    applyDom(resolvedDark, settings.seed)
  }, [settings.seed, resolvedDark])

  // Guards a running theme reveal so rapid clicks can't stack transitions.
  const themeTransitionActive = useRef(false)

  const value = useMemo<SettingsCtx>(
    () => ({
      ...settings,
      resolvedDark,
      setTheme: (theme, origin) => {
        localStorage.setItem('cue-theme', theme)
        const nextDark = theme === 'dark' || (theme === 'system' && systemDark)
        const commit = () => setSettings((s) => ({ ...s, theme }))

        // Circular reveal from the click point (like celox.io): the new theme
        // wipes over the old one via the View Transitions API. Skipped when
        // nothing visually changes, on reduced motion, without API support,
        // or while a reveal is still running.
        if (
          nextDark === resolvedDark ||
          prefersReducedMotion() ||
          !document.startViewTransition ||
          themeTransitionActive.current
        ) {
          commit()
          return
        }
        themeTransitionActive.current = true
        const root = document.documentElement
        root.classList.add('theme-transition')
        const x = origin?.x ?? window.innerWidth / 2
        const y = origin?.y ?? window.innerHeight / 2
        const vt = document.startViewTransition(() => {
          applyDom(nextDark, settings.seed)
          flushSync(commit)
        })
        vt.ready
          .then(() => {
            const endRadius = Math.hypot(
              Math.max(x, window.innerWidth - x),
              Math.max(y, window.innerHeight - y),
            )
            // Shorter on small/touch screens — big snapshots animate a long
            // clip there; keep it snappy instead of janky.
            const small = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches
            root.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: small ? 520 : 900,
                easing: 'cubic-bezier(0.22, 0.08, 0, 1)',
                pseudoElement: '::view-transition-new(root)',
              },
            )
          })
          .catch(() => undefined)
        void vt.finished.finally(() => {
          root.classList.remove('theme-transition')
          themeTransitionActive.current = false
        })
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
    [settings, resolvedDark, systemDark],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings outside provider')
  return ctx
}
