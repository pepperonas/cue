import { useState } from 'react'
import { APP_VERSION } from '../lib/version'
import type { ChangelogEntry } from '../lib/changelog'
import { renderInlineMarkdown } from '../lib/markdown'
import { Icon } from './ui'

/**
 * „Über cue" — Version, Entwickler, Unterstützen, Changelog.
 *
 * Sitzt als letzter Abschnitt in den Einstellungen, weil dort schon alles
 * steht, was die App als Ganzes betrifft (Erscheinungsbild, Konto,
 * Nutzerverwaltung) und die App keinen „System"-Bereich hat.
 *
 * ⚠️ Der Changelog wird **erst beim Aufklappen geladen** (dynamischer Import,
 * dasselbe Muster wie die Statistik-Ansicht): die Datei ist 85 kB groß und
 * gehört nicht in das Bündel, das jeder Start herunterlädt. Deshalb ist der
 * Parser in `lib/changelog.ts` frei von Importen der Datei selbst.
 */

/** Spendenziel — dieselbe Adresse wie im README und in den übrigen Projekten. */
const DONATE_URL =
  'https://www.paypal.com/donate/?business=martin.pfeffer@celox.io&item_name=cue&currency_code=EUR'
/** Google-Maps-Eintrag von celox.io. */
const REVIEW_URL = 'https://g.page/r/CXgdRV3QysvxEBM/review'
const SITE_URL = 'https://celox.io'

type Status = 'idle' | 'loading' | 'ready' | 'error'

export function AboutSection() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [entries, setEntries] = useState<ChangelogEntry[]>([])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || status === 'ready' || status === 'loading') return
    setStatus('loading')
    try {
      const [{ parseChangelog }, { default: raw }] = await Promise.all([
        import('../lib/changelog'),
        import('../../../CHANGELOG.md?raw'),
      ])
      setEntries(parseChangelog(raw))
      setStatus('ready')
    } catch {
      // Ein fehlgeschlagener Nachladeversuch darf die Einstellungen nicht
      // zerlegen — der Rest des Abschnitts bleibt bedienbar.
      setStatus('error')
    }
  }

  return (
    <div className="section">
      <h3>Über cue</h3>

      <dl className="about-facts">
        <dt>Version</dt>
        <dd>
          <code>{APP_VERSION}</code>
        </dd>
        <dt>Entwickelt von</dt>
        <dd>
          Martin Pfeffer ·{' '}
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer">
            celox.io
          </a>
        </dd>
      </dl>

      <p className="muted about-note">
        cue ist kostenlos, quelloffen und werbefrei — gebaut und betrieben von einer
        Person. Wenn es dir etwas wert ist:
      </p>

      <div className="row about-actions">
        <a
          className="btn btn--filled"
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="volunteer_activism" /> Spenden
        </a>
        <a className="btn" href={REVIEW_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="star" /> Auf Google Maps bewerten
        </a>
      </div>

      <button
        type="button"
        className="about-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="about-changelog"
      >
        <Icon name={open ? 'expand_less' : 'expand_more'} />
        Changelog
        {status === 'ready' && <span className="muted"> · {entries.length} Versionen</span>}
      </button>

      {open && (
        <div id="about-changelog" className="about-changelog">
          {status === 'loading' && <p className="muted">Wird geladen …</p>}
          {status === 'error' && (
            <p className="muted">Changelog konnte nicht geladen werden.</p>
          )}
          {status === 'ready' &&
            entries.map((entry) => (
              <article key={entry.version} className="about-release">
                <h4>
                  <span className="about-version">{entry.version}</span>
                  {entry.date && <span className="muted about-date">{entry.date}</span>}
                  {entry.version === APP_VERSION && (
                    <span className="about-current">installiert</span>
                  )}
                </h4>
                {entry.groups.map((group, i) => (
                  <div key={`${group.kind}-${i}`} className="about-group">
                    {group.kind && <div className="about-kind">{group.kind}</div>}
                    <ul>
                      {group.items.map((item, j) => (
                        // Der Changelog ist Markdown und nutzt **fett** und
                        // `code` durchgehend; roh dargestellt stünden dort
                        // Sternchen. Gerendert wird nur die INLINE-Teilmenge
                        // mit dem geprüften Escape-First-Renderer der App —
                        // ein Listenpunkt darf keine Blockstruktur erzeugen.
                        <li key={j} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item) }} />
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            ))}
        </div>
      )}
    </div>
  )
}
