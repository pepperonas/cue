import { useCallback, useState } from 'react'
import { EXPORT_MODE_KEY, parseMode, type ExportZiel } from '../lib/export'

function load(): ExportZiel {
  try {
    return parseMode(localStorage.getItem(EXPORT_MODE_KEY))
  } catch {
    return 'datei'
  }
}

/**
 * Wohin ein Export geht — Datei oder Zwischenablage.
 *
 * Detail-Dialog und Auswahlleiste fragen beide hier. Sie sind nie gleichzeitig
 * offen (ein Klick auf eine Karte im Auswahlmodus hakt sie an, statt sie zu
 * öffnen), halten also je eigenen React-Zustand und treffen sich in
 * `localStorage` — dasselbe Muster wie der Zuklapp-Zustand der getesteten
 * Prompts. Das macht aus zwei Stellen EINE Einstellung statt zweier, die
 * einander nur ähneln.
 *
 * Voreinstellung Datei: sie ist die verlustfreie von beiden — eine
 * Zwischenablage ist nach dem nächsten Kopiervorgang weg.
 */
export function useExportMode(): [ExportZiel, (ziel: ExportZiel) => void] {
  const [ziel, setZiel] = useState<ExportZiel>(load)
  const waehle = useCallback((next: ExportZiel) => {
    setZiel(next)
    try {
      localStorage.setItem(EXPORT_MODE_KEY, next)
    } catch {
      /* privater Modus / Kontingent — der Export läuft, er vergisst nur */
    }
  }, [])
  return [ziel, waehle]
}
