import { motion } from 'motion/react'
import { api } from '../lib/api'
import { springs } from '../lib/motion'
import { Footer, Icon } from './ui'

const AUTH_ERRORS: Record<string, string> = {
  forbidden: 'Dieser Google-Account ist nicht freigeschaltet.',
  denied: 'Anmeldung abgebrochen.',
  state: 'Sitzung abgelaufen — bitte erneut versuchen.',
  profile: 'Google-Profil unvollständig (E-Mail nicht verifiziert?).',
  google: 'Google-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
  token: 'Google-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
}

export function Login() {
  const params = new URLSearchParams(window.location.search)
  const errKey = params.get('auth_error')
  const error = errKey ? AUTH_ERRORS[errKey] ?? 'Anmeldung fehlgeschlagen.' : ''

  return (
    <div className="app">
      <div className="login-wrap">
        <motion.div
          className="login-card"
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

          {error && (
            <motion.p
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
              style={{ color: 'var(--md-error)', margin: 0 }}
            >
              {error}
            </motion.p>
          )}

          <a className="btn btn--filled google-btn" href={api.googleLoginUrl}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"
              />
            </svg>
            Mit Google anmelden
          </a>

          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            Neue Konten werden nach der Anmeldung vom Admin freigeschaltet.
          </p>
        </motion.div>

        <LandingFeatures />
      </div>
      <Footer />
    </div>
  )
}


const FEATURES: {
  icon: string
  title: string
  text: string
  shot?: { src: string; alt: string }
}[] = [
  {
    icon: 'view_kanban',
    title: 'Prompt-Queue als Kanban-Board',
    text: 'Geplante Claude-Code-Prompts erfassen, nach Projekt gruppieren und per Drag & Drop durch Queued → Running → Done ziehen. Mit Tags, Bookmarks, Blocked-Status, „Getestet"-Haken und 1-Klick-Copy in die CLI.',
    shot: { src: '/landing/board-demo.png', alt: 'cue-Board mit Beispiel-Prompts in drei Spalten' },
  },
  {
    icon: 'play_circle',
    title: 'Runs: Prompts headless ausführen',
    text: 'Gespeicherte Prompts laufen über einen Runner direkt durch die Claude-Code-CLI — einzeln oder als Playbook in einer Session, bis zu drei parallel. Mit Live-Log, Kosten, Cancel und automatischem Verschieben nach Done.',
    shot: { src: '/landing/runs-demo.png', alt: 'Runs-Ansicht mit laufendem und abgeschlossenem Run' },
  },
  {
    icon: 'data_object',
    title: 'Snippet-Werkbank für Inspector Rust',
    text: 'IR-Backup importieren, Snippets gruppieren, versionieren und bearbeiten, wieder als IR-Backup exportieren — verlustfreier Roundtrip inklusive leerer Gruppen.',
    shot: { src: '/landing/snippets-demo.png', alt: 'Snippet-Bibliothek mit Gruppen und Versionsnummern' },
  },
]

const MORE: { icon: string; label: string }[] = [
  { icon: 'history', label: 'CLI-Prompt-Capture mit Verlauf' },
  { icon: 'send', label: 'Prompts in laufende Sessions tippen' },
  { icon: 'merge', label: 'Prompts zusammenführen' },
  { icon: 'upload_file', label: 'Import & Export (JSON/ZIP/IR)' },
  { icon: 'install_mobile', label: 'Installierbare PWA' },
  { icon: 'palette', label: 'Material You Dynamic Color' },
  { icon: 'lock', label: 'Multi-Tenant mit Google-Login' },
]

/** Feature tour below the login card — the sign-in stays on top on purpose
 * (the audience is small and approved manually; fast access matters more). */
function LandingFeatures() {
  return (
    <section className="landing">
      <h2 className="landing-title">Was cue kann</h2>
      {FEATURES.map((f, i) => (
        <motion.article
          key={f.title}
          className="landing-feature"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ ...springs.gentle, delay: Math.min(i * 0.05, 0.2) }}
        >
          <div className="landing-feature-head">
            <span className="landing-icon">
              <Icon name={f.icon} />
            </span>
            <div>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          </div>
          {f.shot && (
            <img
              className="landing-shot"
              src={f.shot.src}
              alt={f.shot.alt}
              loading="lazy"
              width={1280}
              height={820}
            />
          )}
        </motion.article>
      ))}
      <div className="landing-more">
        {MORE.map((m) => (
          <span key={m.label} className="chip landing-chip">
            <Icon name={m.icon} /> {m.label}
          </span>
        ))}
      </div>
      <p className="muted landing-note">
        Die Screenshots zeigen Demo-Inhalte. Anmeldung oben — neue Konten schaltet der Admin frei.
      </p>
    </section>
  )
}
