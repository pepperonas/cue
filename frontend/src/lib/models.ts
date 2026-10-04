// Reine Regeln des Modell-Katalogs: was auswählbar ist, was ein Badge zeigt.
// Kein React, kein DOM — deshalb ohne Browser prüfbar.
import type { AiModel } from './types'
import type { Choice } from './select'

/** Sentinel für „kein Modell" in einem Select, das Zahlen führt. */
export const KEIN_MODELL = 0

/** Das Modell eines Prompts — oder undefined, wenn keines/unbekannt. */
export function modelOf(models: AiModel[], id: number | null | undefined): AiModel | undefined {
  if (id == null) return undefined
  return models.find((m) => m.id === id)
}

/**
 * Die Auswahl für einen Prompt.
 *
 * ⚠️ Ein DEAKTIVIERTES Modell bleibt in der Liste, solange es diesem Prompt
 * zugeordnet ist. Sonst stünde der Auslöser auf einem Wert, den seine eigene
 * Liste nicht kennt — die Auswahl sähe leer aus, obwohl etwas zugeordnet ist,
 * und ein Klick daneben würde die Zuordnung stillschweigend verlieren.
 * Angeboten wird es nicht erneut: es steht am Ende und ist als „deaktiviert"
 * beschriftet.
 */
export function modelOptions(
  models: AiModel[],
  currentId: number | null | undefined,
): Choice<number>[] {
  const aktiv = models.filter((m) => m.enabled)
  const zugeordnet = modelOf(models, currentId)
  const liste = [...aktiv]
  if (zugeordnet && !zugeordnet.enabled) liste.push(zugeordnet)
  return [
    { value: KEIN_MODELL, label: 'Kein Modell' },
    ...liste.map((m) => ({
      value: m.id,
      label: m.enabled ? m.name : `${m.name} (deaktiviert)`,
      dot: m.color,
    })),
  ]
}

/**
 * Was auf dem Badge steht.
 *
 * Der Modellname ist die wichtigste Information und steht deshalb allein da —
 * der Anbieter wird über den Farbpunkt unterschieden, nicht über einen
 * zweiten Text. Ohne Zuordnung ist der Badge eine Aufforderung.
 */
export function badgeLabel(model: AiModel | undefined): string {
  return model ? model.name : 'Modell wählen'
}

/** Ein Prompt, dessen Modell abgeschaltet wurde — die Karte kennzeichnet das. */
export function isStale(model: AiModel | undefined): boolean {
  return model != null && !model.enabled
}

/**
 * Die Modelle für die Verwaltung, in der gewünschten Reihenfolge.
 *
 * Nach `sort_order`, wie die Projekte — die Reihenfolge ist gezogen und
 * gehört dem Nutzer. Der Server liefert sie bereits so; hier steht die Regel
 * noch einmal, damit eine Liste aus dem Zwischenspeicher nicht anders aussieht.
 */
export function sortModels(models: AiModel[]): AiModel[] {
  return [...models].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
}

/** Gruppiert nach Anbieter, für die Verwaltung. Reihenfolge bleibt erhalten. */
export function groupByProvider(models: AiModel[]): { provider: string; label: string; models: AiModel[] }[] {
  const gruppen = new Map<string, { provider: string; label: string; models: AiModel[] }>()
  for (const m of sortModels(models)) {
    let g = gruppen.get(m.provider)
    if (!g) {
      g = { provider: m.provider, label: m.provider_label || m.provider, models: [] }
      gruppen.set(m.provider, g)
    }
    g.models.push(m)
  }
  return [...gruppen.values()]
}

/** Das Standardmodell — was ein neuer Prompt bekommt, wenn nichts gewählt ist. */
export function defaultModel(models: AiModel[]): AiModel | undefined {
  return models.find((m) => m.is_default && m.enabled)
}

/**
 * Was die Auswahl im Editor anzeigt.
 *
 * Ein NEUER Prompt hält `undefined` („nichts entschieden — der Server setzt den
 * Standard"). Angezeigt wird dann das Standardmodell, denn genau das wird er
 * bekommen; „Kein Modell" stünde dort, obwohl gleich eines zugewiesen wird.
 */
export function shownModelId(
  models: AiModel[],
  chosen: number | null | undefined,
): number | null {
  if (chosen === undefined) return defaultModel(models)?.id ?? null
  return chosen
}

/**
 * Ob neben der Auswahl „Als Standard" angeboten wird.
 *
 * `'set'`: ein aktives Modell, das noch nicht Standard ist · `'is'`: es ist es
 * schon (der Hinweis sagt das) · `'none'`: nichts gewählt oder deaktiviert —
 * ein abgeschaltetes Modell kann nicht Standard sein (der Server lehnt es ab).
 */
export function defaultAction(
  models: AiModel[],
  id: number | null | undefined,
): 'set' | 'is' | 'none' {
  const m = modelOf(models, id)
  if (!m || !m.enabled) return 'none'
  return m.is_default ? 'is' : 'set'
}
