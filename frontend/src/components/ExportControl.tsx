import { copyText } from '../lib/clipboard'
import { saveTextFile } from '../lib/download'
import { exportFilename, exportJson, promptAnzahl, type ExportZiel } from '../lib/export'
import type { Prompt } from '../lib/types'
import { useModels, useProjects } from '../state/queries'
import { useExportMode } from '../state/export-mode'
import { useToast } from '../state/toast'
import { Button, Icon } from './ui'

const ZIELE: { ziel: ExportZiel; icon: string; label: string; hinweis: string }[] = [
  { ziel: 'datei', icon: 'download', label: 'Datei', hinweis: 'Als .json-Datei speichern' },
  {
    ziel: 'zwischenablage',
    icon: 'content_copy',
    label: 'Zwischenablage',
    hinweis: 'Als JSON in die Zwischenablage kopieren',
  },
]

/**
 * Prompts als JSON hinausgeben — im Detail-Dialog für einen, in der
 * Auswahlleiste für mehrere.
 *
 * EINE Komponente, zwei Gastgeber: der Inhalt der Datei und der der
 * Zwischenablage sind dieselbe Frage, und zwei Umsetzungen davon würden
 * auseinanderlaufen (dasselbe Argument wie bei `PromptEditor`).
 *
 * ⚠️ Der Umschalter trägt die WAHL, der Knopf führt sie aus. Zwei getrennte
 * Knöpfe („Als Datei" / „Kopieren") wären ohne verstecktes Zustandsbit
 * ausgekommen, aber die Auswahlleiste trägt bereits sieben Bedienelemente und
 * `.row-end` im Dialog vier — gemessen bricht die Reihe auf dem Handy schon
 * heute um. Damit trotzdem niemand in den falschen Modus greift, steht die
 * gewählte Ausgabe gefüllt direkt neben dem Knopf, und dessen `title` spricht
 * den ganzen Satz aus.
 *
 * ⚠️ Projekte und Modelle holt die Komponente SELBST (React Query entdoppelt
 * die Abfragen, beide liegen ohnehin im Cache) — durchgereichte Listen wären
 * zwei Wege zu demselben Kontext, und der Export bekäme je nach Gastgeber einen
 * anderen Projektnamen.
 */
export function ExportControl({ prompts, compact = false }: { prompts: Prompt[]; compact?: boolean }) {
  const [ziel, waehleZiel] = useExportMode()
  const { data: projects } = useProjects()
  const { data: models } = useModels()
  const toast = useToast()
  const leer = prompts.length === 0

  const fuehreAus = async () => {
    if (leer) return
    const jetzt = new Date()
    const text = exportJson(prompts, { projekte: projects, modelle: models?.models, jetzt })
    const wieviele = promptAnzahl(prompts.length)
    if (ziel === 'zwischenablage') {
      const ok = await copyText(text)
      toast.show(
        ok ? `${wieviele} als JSON kopiert` : 'Kopieren nicht möglich',
        ok ? 'success' : 'error',
      )
      return
    }
    const name = exportFilename(prompts, jetzt)
    const ok = saveTextFile(name, text)
    toast.show(ok ? `${wieviele} als ${name} gespeichert` : 'Speichern nicht möglich', ok ? 'success' : 'error')
  }

  const satz =
    ziel === 'datei'
      ? `${promptAnzahl(prompts.length)} als JSON-Datei speichern`
      : `${promptAnzahl(prompts.length)} als JSON in die Zwischenablage kopieren`

  return (
    <span className={`export-ctl${compact ? ' export-ctl--compact' : ''}`} role="group" aria-label="Export">
      <span className="export-mode" role="radiogroup" aria-label="Ausgabe">
        {ZIELE.map((z) => (
          <button
            key={z.ziel}
            type="button"
            role="radio"
            aria-checked={ziel === z.ziel}
            className="export-mode-opt"
            data-on={ziel === z.ziel ? 'true' : undefined}
            title={z.hinweis}
            aria-label={z.hinweis}
            onClick={() => waehleZiel(z.ziel)}
          >
            <Icon name={z.icon} />
            <span className="export-mode-label">{z.label}</span>
          </button>
        ))}
      </span>
      <Button
        variant="tonal"
        icon="data_object"
        className={compact ? 'btn--compact' : undefined}
        disabled={leer}
        title={satz}
        aria-label={satz}
        onClick={fuehreAus}
      >
        Exportieren
      </Button>
    </span>
  )
}
