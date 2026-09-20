// Die zentrale Modellverwaltung — bewusst dieselbe Formensprache wie die
// Projekt- und Tag-Verwaltung: Liste aus `.list-item`-Zeilen, Ziehen über die
// Zeile (dnd-kit wie in `ProjectsView`), `Confirm` fürs Löschen, `Select` für
// jede Auswahl. Es entsteht kein zweites Verwaltungskonzept.
//
// Was hier anders ist als bei den Tags, und warum:
//   · **Deaktivieren steht vor Löschen.** Ein Modell trägt die Aussage „damit
//     soll dieser Prompt abgearbeitet werden"; ein gelöschtes nimmt sie mit.
//     Der Server lehnt das Löschen eines benutzten Modells ohne Ersatz ab.
//   · **Genau ein Standard.** Er entscheidet, was ein neuer Prompt bekommt.
import { useState } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'
import { useBackDismiss } from '../state/overlays'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDragSensors } from '../lib/dnd'
import { sortModels } from '../lib/models'
import type { AiModel, AiModelProvider } from '../lib/types'
import {
  useCreateModel,
  useDeleteModel,
  useModels,
  useReorderModels,
  useUpdateModel,
} from '../state/queries'
import { useToast } from '../state/toast'
import { Select } from './Select'
import { Button, Icon, IconButton, Switch } from './ui'

interface Entwurf {
  id?: number
  name: string
  provider: string
  api_id: string
  description: string
  is_default: boolean
}

const LEER: Entwurf = {
  name: '',
  provider: 'custom',
  api_id: '',
  description: '',
  is_default: false,
}

export function ModelsView() {
  const toast = useToast()
  const { data, isLoading } = useModels()
  const create = useCreateModel()
  const update = useUpdateModel()
  const del = useDeleteModel()
  const reorder = useReorderModels()
  const sensors = useDragSensors()

  const [entwurf, setEntwurf] = useState<Entwurf | null>(null)
  const [loeschen, setLoeschen] = useState<AiModel | null>(null)
  const [ersatz, setErsatz] = useState<number>(0)

  const modelle = sortModels(data?.models ?? [])
  const provider = data?.providers ?? []

  function ziehen(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const von = modelle.findIndex((m) => m.id === active.id)
    const nach = modelle.findIndex((m) => m.id === over.id)
    if (von < 0 || nach < 0) return
    reorder.mutate(arrayMove(modelle, von, nach).map((m) => m.id))
  }

  async function speichern(werte: Entwurf) {
    try {
      if (werte.id) {
        await update.mutateAsync({
          id: werte.id,
          patch: {
            name: werte.name,
            provider: werte.provider,
            api_id: werte.api_id,
            description: werte.description,
            is_default: werte.is_default,
          },
        })
        toast.show('Modell gespeichert', 'success')
      } else {
        await create.mutateAsync(werte)
        toast.show('Modell angelegt', 'success')
      }
      setEntwurf(null)
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
    }
  }

  async function wirklichLoeschen() {
    if (!loeschen) return
    try {
      const r = await del.mutateAsync({
        id: loeschen.id,
        replaceWith: loeschen.usage > 0 ? ersatz || null : null,
      })
      toast.show(
        r.reassigned > 0
          ? `Gelöscht — ${r.reassigned} Prompt(s) umgehängt`
          : 'Modell gelöscht',
        'success',
      )
      setLoeschen(null)
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : 'Löschen fehlgeschlagen', 'error')
    }
  }

  const ersatzOptionen = loeschen
    ? modelle.filter((m) => m.id !== loeschen.id && m.enabled).map((m) => ({ value: m.id, label: m.name, dot: m.color }))
    : []

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0 }}>Modelle</h3>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Mit welchem Modell ein Prompt abgearbeitet werden soll. Die Reihenfolge
            hier ist die Reihenfolge in jeder Auswahl — ziehe die Zeilen.
          </p>
        </div>
        <Button icon="add" onClick={() => setEntwurf({ ...LEER })}>
          Neues Modell
        </Button>
      </div>

      {isLoading ? (
        <div className="skeleton" style={{ height: 180, marginTop: 'var(--gap-4)' }} />
      ) : modelle.length === 0 ? (
        <div className="empty">
          <Icon name="smart_toy" />
          <h3 style={{ margin: 0 }}>Keine Modelle</h3>
          <p className="muted">Lege eines an — Prompts zeigen dann „Modell wählen“.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={ziehen}>
          <SortableContext items={modelle.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="model-list">
              {modelle.map((m) => (
                <ModelRow
                  key={m.id}
                  m={m}
                  onEdit={() =>
                    setEntwurf({
                      id: m.id,
                      name: m.name,
                      provider: m.provider,
                      api_id: m.api_id,
                      description: m.description,
                      is_default: m.is_default,
                    })
                  }
                  onToggle={(on) => update.mutate({ id: m.id, patch: { enabled: on } })}
                  onDefault={() => update.mutate({ id: m.id, patch: { is_default: true } })}
                  onDelete={() => {
                    setErsatz(0)
                    setLoeschen(m)
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {data?.catalog_state && (
        <p className="muted model-source">
          Die mitgelieferten Modelle sind recherchiert (Stand {data.catalog_state}) und lassen
          sich hier bearbeiten, deaktivieren oder löschen.
        </p>
      )}

      {entwurf && (
        <ModelDialog
          entwurf={entwurf}
          providers={provider}
          busy={create.isPending || update.isPending}
          onClose={() => setEntwurf(null)}
          onSave={speichern}
        />
      )}

      {loeschen && (
        <ModelDeleteDialog
          m={loeschen}
          ersatz={ersatz}
          setErsatz={setErsatz}
          optionen={ersatzOptionen}
          busy={del.isPending}
          onClose={() => setLoeschen(null)}
          onConfirm={wirklichLoeschen}
        />
      )}
    </div>
  )
}

function ModelRow({
  m,
  onEdit,
  onToggle,
  onDefault,
  onDelete,
}: {
  m: AiModel
  onEdit: () => void
  onToggle: (on: boolean) => void
  onDefault: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: m.id,
  })
  // Wie bei den Projektzeilen: Klicks auf die Bedienelemente dürfen keinen
  // Zug starten.
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <div
      ref={setNodeRef}
      className={`list-item model-row ${isDragging ? 'dragging' : ''}`}
      data-disabled={!m.enabled}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <span className="dot model-dot" style={{ background: m.color }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="model-name">
          {m.name}
          {m.is_default && <span className="model-flag">Standard</span>}
          {!m.enabled && <span className="model-flag off">deaktiviert</span>}
        </div>
        <div className="muted model-meta">
          {m.provider_label}
          {m.api_id && (
            <>
              {' · '}
              <code>{m.api_id}</code>
            </>
          )}
          {m.usage > 0 && ` · ${m.usage} Prompt(s)`}
        </div>
        {m.description && <div className="muted model-desc">{m.description}</div>}
      </div>
      <span className="model-actions" onPointerDown={stop} onClick={(e) => e.stopPropagation()}>
        {!m.is_default && m.enabled && (
          <button className="mini-btn" title="Als Standard für neue Prompts" onClick={onDefault}>
            <Icon name="star" />
          </button>
        )}
        <Switch on={m.enabled} onChange={onToggle} label={`${m.name} aktiv`} />
        <IconButton icon="edit" label="Bearbeiten" onClick={onEdit} />
        <IconButton icon="delete" label="Löschen" onClick={onDelete} />
      </span>
    </div>
  )
}

function ModelDialog({
  entwurf,
  providers,
  busy,
  onClose,
  onSave,
}: {
  entwurf: Entwurf
  providers: AiModelProvider[]
  busy: boolean
  onClose: () => void
  onSave: (e: Entwurf) => void
}) {
  const [werte, setWerte] = useState<Entwurf>(entwurf)
  const setzen = <K extends keyof Entwurf>(k: K, v: Entwurf[K]) =>
    setWerte((alt) => ({ ...alt, [k]: v }))

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ font: 'var(--headline-m)', margin: 0 }}>
            {werte.id ? 'Modell bearbeiten' : 'Neues Modell'}
          </h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        <div className="field">
          <label htmlFor="modell-name">Name</label>
          <input
            id="modell-name"
            className="input"
            autoFocus
            value={werte.name}
            placeholder="z. B. Claude Opus 5"
            onChange={(e) => setzen('name', e.target.value)}
          />
        </div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="modell-provider">Anbieter</label>
            <Select
              id="modell-provider"
              value={werte.provider}
              options={providers.map((p) => ({ value: p.id, label: p.label, dot: p.color }))}
              onChange={(v) => setzen('provider', v)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="modell-api">Kennung (optional)</label>
            <input
              id="modell-api"
              className="input mono"
              value={werte.api_id}
              placeholder="claude-opus-5"
              onChange={(e) => setzen('api_id', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="modell-desc">Notiz (optional)</label>
          <input
            id="modell-desc"
            className="input"
            value={werte.description}
            placeholder="Wofür dieses Modell gedacht ist"
            onChange={(e) => setzen('description', e.target.value)}
          />
        </div>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={werte.is_default}
            onChange={(e) => setzen('is_default', e.target.checked)}
          />
          <span>Standard für neue Prompts</span>
        </label>

        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button icon="check" disabled={busy || !werte.name.trim()} onClick={() => onSave(werte)}>
            Speichern
          </Button>
        </div>
      </div>
    </div>
  )
}


/**
 * Löschen mit Ersatz — eigener Dialog in der `.dialog`-Sprache, wie ihn die
 * Tag-Verwaltung für denselben Fall schon hat. `Confirm` bleibt unangetastet:
 * es kennt weder Inhalt noch einen gesperrten Knopf, und es dafür zu erweitern
 * hieße, eine geteilte Komponente für einen Sonderfall zu verbiegen.
 */
function ModelDeleteDialog({
  m,
  ersatz,
  setErsatz,
  optionen,
  busy,
  onClose,
  onConfirm,
}: {
  m: AiModel
  ersatz: number
  setErsatz: (v: number) => void
  optionen: { value: number; label: string; dot?: string }[]
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  useBackDismiss(onClose)
  const benutzt = m.usage > 0
  // Ohne Ersatz ginge die Zuordnung verloren — der Server lehnt das ab, und
  // der Knopf sagt es, statt den Nutzer in einen Fehler laufen zu lassen.
  const gesperrt = busy || (benutzt && optionen.length > 0 && !ersatz)

  return (
    <div className="scrim" onClick={onClose}>
      <motion.div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={springs.bouncy}
      >
        <h2>Modell „{m.name}“ löschen?</h2>
        {benutzt ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Es ist <b>{m.usage}</b> {m.usage === 1 ? 'Prompt' : 'Prompts'} zugeordnet. Beim
              Löschen müssen sie ein anderes Modell bekommen.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              <b>Oder brich ab und deaktiviere es</b> — dann bleibt die Zuordnung erhalten und
              das Modell wird nur nicht mehr angeboten.
            </p>
            {optionen.length > 0 ? (
              <div className="field" style={{ marginTop: 'var(--gap-2)' }}>
                <label htmlFor="modell-ersatz">Stattdessen zuordnen</label>
                <Select
                  id="modell-ersatz"
                  value={ersatz}
                  options={optionen}
                  onChange={setErsatz}
                  placeholder="— Ersatzmodell wählen —"
                />
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Es gibt kein anderes aktives Modell. Deaktiviere dieses stattdessen.
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Dieses Modell ist keinem Prompt zugeordnet.
          </p>
        )}
        <div className="row-end">
          <Button variant="text" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="danger" icon="delete" disabled={gesperrt} onClick={onConfirm}>
            Löschen
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
