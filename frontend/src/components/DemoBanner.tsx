import { LANDING_PATH } from '../lib/route'
import { api } from '../lib/api'
import { Icon } from './ui'

/**
 * Der Streifen über der Demo.
 *
 * Sagt zwei Dinge, die ein Besucher wissen muss, bevor er etwas tut: dass die
 * Daten erfunden sind und dass nichts davon bleibt. Beides gehört sichtbar an
 * den Anfang — eine Demo, die sich für die echte App ausgibt, ist eine
 * Täuschung, und ein Board, dessen Arbeit beim Neuladen verschwindet, ohne
 * dass es jemand angekündigt hat, ist ärgerlich.
 */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      <Icon name="science" />
      <span className="demo-banner-text">
        <strong>Demo</strong> mit erfundenen Daten — bedienbar, aber nichts wird gespeichert.
        Ein Neuladen setzt zurück.
      </span>
      <span className="grow" />
      <a className="btn btn--text" href={LANDING_PATH}>
        Zurück
      </a>
      <a className="btn btn--filled" href={api.googleLoginUrl}>
        <Icon name="login" /> Anmelden
      </a>
    </div>
  )
}
