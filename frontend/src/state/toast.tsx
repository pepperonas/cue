import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { springs } from '../lib/motion'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
  action?: ToastAction
}

interface ShowOptions {
  action?: ToastAction
  duration?: number
}

interface ToastCtx {
  show: (message: string, tone?: Toast['tone'], opts?: ShowOptions) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: Toast['tone'] = 'info', opts?: ShowOptions) => {
      const id = ++seq.current
      setToasts((t) => [...t, { id, message, tone, action: opts?.action }])
      // Actions (e.g. undo) get more time to react.
      const duration = opts?.duration ?? (opts?.action ? 6000 : 2800)
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration)
    },
    [],
  )

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast toast--${t.tone}`}
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={springs.bouncy}
              layout
            >
              <span className="material-symbols-rounded">
                {t.tone === 'success' ? 'check_circle' : t.tone === 'error' ? 'error' : 'info'}
              </span>
              <span className="toast-msg">{t.message}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action?.onClick()
                    dismiss(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside provider')
  return ctx
}
