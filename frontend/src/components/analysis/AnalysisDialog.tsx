// Der Vorschlag einer Projekt-Analyse — lesen, verstehen, entscheiden.
//
// Wie bei der Optimierung gilt: nichts wird von allein geschrieben. „Übernehmen"
// schreibt ausschließlich die Reihenfolge und die vorgeschlagenen Prioritäten;
// Zusammenführen und Archivieren laufen über die bestehenden Wege, damit ein
// Merge rückabwickelbar bleibt und ein Statuswechsel alle Regeln durchläuft.
import { useState } from 'react'
import { motion } from 'motion/react'
import {
  abweichungen,
  boardFolge,
  prioritaetsAenderungen,
  type Analysis,
} from '../../lib/analysis'
import { springs } from '../../lib/motion'
import type { Prompt } from '../../lib/types'
import { useBackDismiss } from '../../state/overlays'
import { Button, Icon, IconButton } from '../ui'
import { FlowGraph } from './FlowGraph'

type Reiter = 'reihenfolge' | 'plan' | 'funde'

export function AnalysisDialog({
  analysis,
  prompts,
  busy,
  onClose,
  onApply,
  onDiscard,
  onCancel,
  onOpenPrompt,
  onMerge,
  onArchive,
}: {
  analysis: Analysis
  prompts: Map<number, Prompt>
  busy: boolean
  onClose: () => void
  onApply: () => void
  onDiscard: () => void
  onCancel: () => void
  onOpenPrompt: (id: number) => void
  onMerge: (ids: number[]) => void
  onArchive: (id: number) => void
}) {
  useBackDismiss(onClose)
  const [reiter, setReiter] = useState<Reiter>('reihenfolge')
  const ergebnis = analysis.result
  const titel = new Map([...prompts].map(([id, p]) => [id, p.title || `#${id}`]))

  const laeuft = analysis.status === 'queued' || analysis.status === 'running'
  const entscheidbar =
    analysis.status === 'succeeded' && analysis.decision === 'pending' && ergebnis !== null

  const funde = ergebnis ? ergebnis.zusammenfuehren.length + ergebnis.redundant.length : 0
  const prioAenderungen = ergebnis ? prioritaetsAenderungen(ergebnis.reihenfolge) : []
  const abweichend = ergebnis ? abweichungen(ergebnis.reihenfolge, prompts) : 0

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="sheet sheet--analysis"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springs.spatial}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ font: 'var(--headline-m)', margin: 0, minWidth: 0 }}>
            Analyse · {analysis.project_name}
          </h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        {laeuft && (
          <div className="analysis-running">
            <div className="spinner" />
            <div>
              <b>Die KI liest {analysis.prompt_count} Prompts.</b>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Das dauert meist unter einer Minute. Du kannst das Fenster schließen — der
                Lauf geht weiter.
              </p>
            </div>
            <Button variant="text" onClick={onCancel} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        )}

        {analysis.status === 'failed' && (
          <div className="analysis-error">
            <Icon name="error" />
            <div>
              <b>Die Analyse ist gescheitert.</b>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {analysis.error || 'Unbekannter Fehler'}
              </p>
            </div>
          </div>
        )}

        {ergebnis && (
          <>
            {analysis.stale && (
              <p className="analysis-warn">
                <Icon name="history" /> Seit diesem Lauf haben sich Daten geändert — der
                Vorschlag beschreibt einen älteren Stand.
              </p>
            )}

            {ergebnis.zusammenfassung && (
              <p className="analysis-sum">{ergebnis.zusammenfassung}</p>
            )}

            <div className="tabs analysis-tabs" role="tablist">
              {(
                [
                  ['reihenfolge', 'Reihenfolge', ergebnis.reihenfolge.length],
                  ['plan', 'Ablaufplan', ergebnis.phasen.length],
                  ['funde', 'Funde', funde],
                ] as [Reiter, string, number][]
              ).map(([schluessel, label, zahl]) => (
                <button
                  key={schluessel}
                  className="tab"
                  role="tab"
                  aria-selected={reiter === schluessel}
                  data-active={reiter === schluessel}
                  onClick={() => setReiter(schluessel)}
                >
                  {label}
                  {zahl > 0 && <span className="analysis-count">{zahl}</span>}
                </button>
              ))}
            </div>

            <div className="detail-scroll">
              {reiter === 'reihenfolge' && (
                <Reihenfolge
                  analysis={analysis}
                  prompts={prompts}
                  abweichend={abweichend}
                  prioAenderungen={prioAenderungen.length}
                  onOpenPrompt={onOpenPrompt}
                />
              )}
              {reiter === 'plan' && (
                <FlowGraph result={ergebnis} titel={titel} onSelect={onOpenPrompt} />
              )}
              {reiter === 'funde' && (
                <Funde
                  analysis={analysis}
                  prompts={prompts}
                  onMerge={onMerge}
                  onArchive={onArchive}
                  onOpenPrompt={onOpenPrompt}
                />
              )}

              {ergebnis.hinweise.length > 0 && (
                <details className="analysis-notes">
                  <summary>Was beim Auswerten verworfen wurde ({ergebnis.hinweise.length})</summary>
                  <ul>
                    {ergebnis.hinweise.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </>
        )}

        {entscheidbar && (
          <div className="opt-decide">
            <p className="opt-decide-text">
              <Icon name="rule" />
              <span>
                <b>Nur die Reihenfolge wird geschrieben</b>
                <span className="opt-decide-note">
                  {prioAenderungen.length > 0
                    ? ` — dazu ${prioAenderungen.length} Priorität${
                        prioAenderungen.length === 1 ? '' : 'en'
                      }. Zusammenführen und Archivieren entscheidest du einzeln.`
                    : ' — Zusammenführen und Archivieren entscheidest du einzeln.'}
                </span>
              </span>
            </p>
            <div className="row" style={{ gap: 'var(--gap-2)' }}>
              <Button variant="text" onClick={onDiscard} disabled={busy}>
                Verwerfen
              </Button>
              <Button icon="check" onClick={onApply} disabled={busy}>
                Reihenfolge übernehmen
              </Button>
            </div>
          </div>
        )}

        {analysis.decision !== 'pending' && (
          <p className="muted analysis-done">
            {analysis.decision === 'applied'
              ? 'Die Reihenfolge wurde übernommen.'
              : 'Dieser Vorschlag wurde verworfen — er bleibt lesbar.'}
          </p>
        )}
      </motion.div>
    </div>
  )
}

function Reihenfolge({
  analysis,
  prompts,
  abweichend,
  prioAenderungen,
  onOpenPrompt,
}: {
  analysis: Analysis
  prompts: Map<number, Prompt>
  abweichend: number
  prioAenderungen: number
  onOpenPrompt: (id: number) => void
}) {
  const ergebnis = analysis.result!
  const echt = boardFolge(ergebnis.reihenfolge, prompts)
  return (
    <>
      {abweichend > 0 && (
        <p className="analysis-warn">
          <Icon name="swap_vert" />
          {abweichend} Prompt{abweichend === 1 ? '' : 's'} landen wegen ihrer Priorität an
          anderer Stelle — die Queue sortiert erst nach Priorität, dann nach dieser Folge.
        </p>
      )}
      {prioAenderungen > 0 && (
        <p className="muted analysis-hint">
          <Icon name="flag" /> {prioAenderungen} Priorität
          {prioAenderungen === 1 ? ' wird' : 'en werden'} mit übernommen.
        </p>
      )}
      <ol className="analysis-order">
        {ergebnis.reihenfolge.map((schritt) => {
          const prompt = prompts.get(schritt.prompt_id)
          if (!prompt) return null
          const position = echt.indexOf(schritt.prompt_id) + 1
          return (
            <li key={schritt.prompt_id} className="analysis-step">
              <span className="analysis-rank" title={`Landet auf Position ${position}`}>
                {schritt.rang}
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <button className="linklike" onClick={() => onOpenPrompt(schritt.prompt_id)}>
                  {prompt.title || `#${schritt.prompt_id}`}
                </button>
                {schritt.begruendung && (
                  <p className="muted analysis-why">{schritt.begruendung}</p>
                )}
                {schritt.ergaenzt && (
                  <p className="muted analysis-why">
                    Von der KI nicht eingeordnet — steht unverändert hier.
                  </p>
                )}
              </div>
              {schritt.prioritaet && (
                <span className={`analysis-prio prio-${schritt.prioritaet}`}>
                  {prompt.priority} → {schritt.prioritaet}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

function Funde({
  analysis,
  prompts,
  onMerge,
  onArchive,
  onOpenPrompt,
}: {
  analysis: Analysis
  prompts: Map<number, Prompt>
  onMerge: (ids: number[]) => void
  onArchive: (id: number) => void
  onOpenPrompt: (id: number) => void
}) {
  const ergebnis = analysis.result!
  const name = (id: number) => prompts.get(id)?.title || `#${id}`
  if (ergebnis.zusammenfuehren.length === 0 && ergebnis.redundant.length === 0) {
    return (
      <p className="muted">
        Keine Dopplungen und keine überflüssigen Prompts gefunden — die Queue ist sauber.
      </p>
    )
  }
  return (
    <div className="analysis-finds">
      {ergebnis.zusammenfuehren.length > 0 && (
        <section>
          <h3>Könnten zusammen bearbeitet werden</h3>
          {ergebnis.zusammenfuehren.map((b, i) => {
            const vorhanden = b.prompt_ids.filter((id) => prompts.has(id))
            return (
              <div className="analysis-find" key={i}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b>{b.titel || vorhanden.map(name).join(' [&] ')}</b>
                  <ul className="analysis-members">
                    {vorhanden.map((id) => (
                      <li key={id}>
                        <button className="linklike" onClick={() => onOpenPrompt(id)}>
                          {name(id)}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {b.begruendung && <p className="muted analysis-why">{b.begruendung}</p>}
                </div>
                <Button
                  variant="tonal"
                  icon="merge"
                  onClick={() => onMerge(vorhanden)}
                  disabled={vorhanden.length < 2}
                >
                  Zusammenführen
                </Button>
              </div>
            )
          })}
        </section>
      )}

      {ergebnis.redundant.length > 0 && (
        <section>
          <h3>Vermutlich überflüssig</h3>
          {ergebnis.redundant.map((r) => (
            <div className="analysis-find" key={r.prompt_id}>
              <div className="grow" style={{ minWidth: 0 }}>
                <button className="linklike" onClick={() => onOpenPrompt(r.prompt_id)}>
                  {name(r.prompt_id)}
                </button>
                {r.grund && <p className="muted analysis-why">{r.grund}</p>}
                {r.abgedeckt_von != null && prompts.has(r.abgedeckt_von) && (
                  <p className="muted analysis-why">
                    Abgedeckt von „{name(r.abgedeckt_von)}"
                  </p>
                )}
              </div>
              <Button
                variant="tonal"
                icon="inventory_2"
                onClick={() => onArchive(r.prompt_id)}
              >
                Archivieren
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
