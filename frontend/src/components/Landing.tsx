import { motion } from 'motion/react'
import { api } from '../lib/api'
import { springs } from '../lib/motion'
import { useSettings } from '../state/settings'
import { Footer, Icon, IconButton } from './ui'

/**
 * The public face of cue.
 *
 * Two audiences, one page: a visitor gets the pitch and a sign-in button, a
 * signed-in user who came back from the app gets the same page with "Zur App"
 * instead. Nothing here is behind the auth gate, which is what makes the
 * address shareable.
 *
 * ⚠️ It also carries the OAuth error. Google redirects failures back to `/`
 * with `?auth_error=…`, and this is the first thing rendered there — dropping
 * that would leave a failed login silently on a page that just says "anmelden"
 * again.
 */
const AUTH_ERRORS: Record<string, string> = {
  forbidden: 'Dieser Google-Account ist nicht freigeschaltet.',
  denied: 'Anmeldung abgebrochen.',
  state: 'Sitzung abgelaufen — bitte erneut versuchen.',
  profile: 'Google-Profil unvollständig (E-Mail nicht verifiziert?).',
  google: 'Google-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
  token: 'Google-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
}

/** The three that carry the product; everything else is a chip below. */
const FEATURES: {
  icon: string
  title: string
  text: string
  shot?: { src: string; alt: string; wide?: boolean }
}[] = [
  {
    icon: 'view_kanban',
    title: 'Prompt-Queue als Kanban-Board',
    text: 'Geplante Claude-Code-Prompts erfassen, nach Projekt gruppieren und per Drag & Drop durch Queued → Running → Done ziehen. Dringendes steht in der Queue oben, Erledigtes und schon Getestetes klappt weg, und ein Klick kopiert den Prompt in die CLI. Die Demo unten ist genau dieses Board.',
    shot: { src: '/landing/board-demo.png', wide: true, alt: 'cue-Board mit Beispiel-Prompts in drei Spalten' },
  },
  {
    icon: 'play_circle',
    title: 'Runs: Prompts headless ausführen',
    text: 'Gespeicherte Prompts laufen über einen Runner direkt durch die Claude-Code-CLI — einzeln oder als Playbook in einer Session, bis zu drei parallel. Mit Live-Log, Kosten, Cancel und automatischem Verschieben nach Done.',
    shot: { src: '/landing/runs-demo.png', wide: true, alt: 'Runs-Ansicht mit laufendem und abgeschlossenem Run' },
  },
  {
    icon: 'auto_awesome',
    title: 'Prompts von der KI umschreiben lassen',
    text: 'Ein Klick schreibt einen Prompt schärfer — samt Titel und Schlagworten. Das Original bleibt immer erhalten, das Ergebnis ist ein Vorschlag mit Diff, den du übernimmst oder verwirfst; ein leerer Vorschlag löscht nie etwas. Bookmarks werden zusätzlich vom Projekt gelöst, damit sie überall passen. Mit eigenem Anthropic-API-Key läuft das auf deine Rechnung.',
    shot: {
      src: '/landing/optimize-demo.png', wide: true,
      alt: 'Detail-Dialog mit dem Unterschied zwischen Original und optimierter Fassung, darunter Übernehmen und Verwerfen',
    },
  },
  {
    icon: 'data_object',
    title: 'Snippet-Werkbank für Inspector Rust',
    text: 'IR-Backup importieren, Snippets gruppieren, versionieren und bearbeiten, wieder als IR-Backup exportieren — verlustfreier Roundtrip inklusive leerer Gruppen. Wahlweise synchronisiert Inspector Rust selbst, dann ist cue die Stelle, an der die Snippets sortiert werden.',
    shot: { src: '/landing/snippets-demo.png', wide: true, alt: 'Snippet-Bibliothek mit Gruppen und Versionsnummern' },
  },
  {
    icon: 'sell',
    title: 'Ordnung, die sich selbst macht',
    text: 'Tags entstehen aus dem Titel — „doku updaten“ trägt `documentation` ein —, das Feld schlägt aus dem eigenen Vokabular vor, und der Titel vervollständigt sich Wort für Wort aus deinen bisherigen. Umbenennen wirkt überall, Löschen zeigt vorher, wen es trifft. Dazu Priorität, Blockiert, „Getestet“ und „Genau testen“ direkt an der Karte.',
  },
  {
    icon: 'devices',
    title: 'Auf allen Geräten derselbe Stand',
    text: 'Was auf dem Telefon entsteht, steht ohne Neuladen am Rechner — jeder Browser hält dafür genau eine Anfrage offen, die antwortet, sobald sich etwas ändert (gemessen: 0,18 s), und bis dahin nichts kostet. Auf dem Handy werden aus den Spalten einklappbare Bereiche, Dialoge zu Bottom-Sheets, und die Tastatur verdeckt keine Knöpfe mehr.',
    shot: { src: '/landing/mobile-demo.png', alt: 'cue auf einem Smartphone mit eingeklappten Statusbereichen' },
  },
  {
    icon: 'insights',
    title: 'Auswertung über Arbeit und Kosten',
    text: 'Ein eigener Tab zeigt, was entstand, was fertig wurde und was es gekostet hat: Zeitverlauf, Aktivitätskalender, Wochentag×Stunde, Projekte, Tags — und für die KI-Optimierung Kosten gesamt, je Prompt, je Versuch und je Modell. Zeitraum von Heute bis Gesamt, gerechnet in deiner Zeitzone.',
  },
  {
    icon: 'lock',
    title: 'Mandantenfähig, selbst gehostet, ohne Tracker',
    text: 'Anmeldung über Google, jedes Konto sieht ausschließlich seine eigenen Daten — durchgesetzt von einem Test, der über jede Route der App läuft. Betrieben auf einem eigenen Server in der EU, ohne Analytics und ohne Drittanbieter außer dem Login und, nur wenn du sie auslöst, Anthropic. Ein hinterlegter API-Key liegt verschlüsselt und wird nie wieder ausgegeben.',
  },
]

const MORE: { icon: string; label: string }[] = [
  { icon: 'history', label: 'CLI-Prompts mitschreiben' },
  { icon: 'send', label: 'In laufende Sessions tippen' },
  { icon: 'merge', label: 'Prompts zusammenführen' },
  { icon: 'content_copy', label: 'Kopieren & Duplizieren' },
  { icon: 'mic', label: 'Diktat statt tippen' },
  { icon: 'image', label: 'Screenshots an Prompts' },
  { icon: 'undo', label: 'Löschen mit Undo' },
  { icon: 'upload_file', label: 'Import & Export' },
  { icon: 'install_mobile', label: 'Als PWA installierbar' },
  { icon: 'palette', label: 'Material-You-Farben' },
  { icon: 'dark_mode', label: 'Hell & Dunkel' },
  { icon: 'keyboard', label: 'Tastatur-Shortcuts' },
]

function GoogleMark() {
  return (
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
  )
}

export function Landing({
  signedIn = false,
  onEnterApp,
  onDemo,
}: {
  /** A signed-in visitor came back from the app — offer the way in, not a login. */
  signedIn?: boolean
  onEnterApp: () => void
  /** Öffnet die Demo — die echte App auf erfundenen Daten, ohne Anmeldung. */
  onDemo: () => void
}) {
  const s = useSettings()
  const params = new URLSearchParams(window.location.search)
  const errKey = params.get('auth_error')
  const error = errKey ? AUTH_ERRORS[errKey] ?? 'Anmeldung fehlgeschlagen.' : ''

  const signIn = signedIn ? (
    <button className="btn btn--filled" onClick={onEnterApp}>
      <Icon name="arrow_forward" /> Zur App
    </button>
  ) : (
    <a className="btn btn--filled google-btn" href={api.googleLoginUrl}>
      <GoogleMark />
      Mit Google anmelden
    </a>
  )

  // Die Demo steht gleichberechtigt neben der Anmeldung: ein Besucher kann cue
  // nicht ausprobieren, ohne freigeschaltet zu werden — ohne diesen Weg bliebe
  // die Seite eine Behauptung.
  const cta = (
    <>
      {signIn}
      <button className="btn btn--outlined" onClick={onDemo}>
        <Icon name="play_circle" /> Demo öffnen
      </button>
    </>
  )

  return (
    <div className="app landing-page">
      {/* A header of its own, not `TopBar`: that one is the app's navigation
          and every tab in it needs a session. */}
      <header className="topbar landing-topbar">
        <div className="brand">
          <img className="logo logo-img" src="/favicon.svg" alt="" width={34} height={34} />
          <span className="brand-name">cue</span>
        </div>
        <div className="topbar-spacer" />
        {/* Same control as the app header, from the same provider: a visitor
            arrives in their system's theme and can still switch, which is what
            "the app's dark/light behaviour" means on a page they see first. */}
        <IconButton
          icon={s.resolvedDark ? 'light_mode' : 'dark_mode'}
          label="Theme wechseln"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            s.setTheme(s.resolvedDark ? 'light' : 'dark', {
              x: e.clientX || r.left + r.width / 2,
              y: e.clientY || r.top + r.height / 2,
            })
          }}
        />
        {/* ⚠️ Auf dem Telefon per CSS ausgeblendet: zwei Knöpfe passen dort
            nicht neben Logo und Theme-Schalter — gemessen liefen sie 96 bis
            166 px über den rechten Rand hinaus. Dieselben Knöpfe stehen
            unmittelbar darunter im Hero und noch einmal am Seitenende. */}
        <div className="landing-topbar-cta">{cta}</div>
      </header>

      <main className="landing-main">
        <motion.section
          className="landing-hero"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.gentle}
        >
          <img className="logo-xl logo-img" src="/favicon.svg" alt="" width={84} height={84} />
          <h1>Die Warteschlange für deine Claude-Code-Prompts</h1>
          <p className="landing-lede">
            Prompts aufschreiben, sobald sie dir einfallen — statt sie im Kopf zu behalten
            oder in einer Textdatei zu verlieren. cue sortiert sie nach Projekt und
            Priorität, führt sie auf Wunsch selbst über die Claude-Code-CLI aus und zeigt
            dir hinterher, was die Arbeit gekostet hat.
          </p>
          {error && (
            <motion.p
              className="landing-error"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
            >
              {error}
            </motion.p>
          )}
          <div className="landing-cta">{cta}</div>
          {!signedIn && (
            <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
              Neue Konten werden nach der Anmeldung vom Admin freigeschaltet.
            </p>
          )}
        </motion.section>

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
                  // Aufnahmen eines Desktop-Fensters. Auf einem Telefon sind
                  // sie auf 358 px zusammengeschoben nicht mehr zu entziffern
                  // und kosten je 230 px Scrollweg — dort werden sie
                  // ausgeblendet. Die Handy-Aufnahme bleibt.
                  data-wide={f.shot.wide ? 'true' : undefined}
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

          <div className="landing-closing">
            {cta}
            <p className="muted landing-note">
              Die Screenshots zeigen Demo-Inhalte.
              {signedIn ? '' : ' Neue Konten schaltet der Admin frei.'}
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
