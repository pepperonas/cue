import { useState } from 'react'
import { motion } from 'motion/react'
import { api, ApiError } from '../lib/api'
import { springs } from '../lib/motion'
import { Button, Footer, Icon, Switch } from './ui'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(password, remember)
      onSuccess()
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Zu viele Versuche. Bitte später erneut.')
      } else {
        setError('Falsches Passwort.')
      }
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <div className="login-wrap">
        <motion.form
          className="login-card"
          onSubmit={submit}
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.bouncy}
        >
          <div className="logo-xl">
            <Icon name="bolt" />
          </div>
          <div>
            <h1 style={{ font: 'var(--headline-l)', margin: 0 }}>cue</h1>
            <p className="muted">Prompt-Queue für Claude-Code-Sessions</p>
          </div>
          <div className="field" style={{ textAlign: 'left' }}>
            <label htmlFor="pw">Passwort</label>
            <input
              id="pw"
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Angemeldet bleiben</span>
            <Switch on={remember} onChange={setRemember} label="Angemeldet bleiben" />
          </div>
          {error && (
            <motion.p
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
              style={{ color: 'var(--md-error)', margin: 0 }}
            >
              {error}
            </motion.p>
          )}
          <Button type="submit" icon="login" disabled={busy || !password}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </Button>
        </motion.form>
      </div>
      <Footer />
    </div>
  )
}
