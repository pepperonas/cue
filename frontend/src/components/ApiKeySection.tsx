import { useState } from 'react'
import { useApiKey, useOptimizeConfig, useSaveApiKey } from '../state/queries'
import { useToast } from '../state/toast'
import { Button, Icon } from './ui'
import { Select } from './Select'

export function ApiKeySection() {
  const apiKeyQuery = useApiKey()
  const apiKey = apiKeyQuery.data
  const config = useOptimizeConfig()
  const cliReady = !!config.data?.enabled && apiKey?.configured === false
  const saveApiKey = useSaveApiKey()
  const toast = useToast()
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState('')
  return (
      <div className="ai-setup-step" id="ai-api-key">
        <h3><span className="setup-number">1</span> KI-Zugang einrichten</h3>
        {cliReady && <p className="setup-success"><Icon name="check_circle" /> Dein CLI-Zugang ist bereit. Ein API-Key ist für dich optional.</p>}
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
          Mit deinem eigenen Anthropic-API-Key kannst du Prompts optimieren und die
          Reihenfolge eines Projekts analysieren. Die API-Nutzung wird auf deinem
          Anthropic-Konto abgerechnet. Du bezahlst ausschließlich deine eigenen Läufe.
        </p>
        <p><a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer">API-Key bei Anthropic erstellen ↗</a></p>
        {apiKeyQuery.isError && <p role="alert" className="opt-error">Der KI-Zugang konnte nicht geladen werden. <button className="btn btn--text" onClick={() => apiKeyQuery.refetch()}>Erneut versuchen</button></p>}
        <div className="field">
          <label htmlFor="anthropic-key">
            API-Key {apiKey?.configured ? `(hinterlegt: ${apiKey.preview})` : '(keiner hinterlegt)'}
          </label>
          <div className="row">
            <input
              id="anthropic-key"
              className="input grow"
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={apiKey?.configured ? 'Neuen Key eingeben zum Ersetzen' : 'sk-ant-…'}
              disabled={saveApiKey.isPending || apiKeyQuery.isPending}
              onChange={(e) => { setKeyInput(e.target.value); setKeyError('') }}
            />
            <Button
              variant="tonal"
              icon="key"
              disabled={!keyInput.trim() || saveApiKey.isPending}
              onClick={() =>
                saveApiKey.mutate(
                  { key: keyInput.trim() },
                  {
                    onSuccess: () => {
                      // Never keep the plaintext in a React state that a crash
                      // report or a devtools snapshot could carry off.
                      setKeyInput('')
                      setKeyError('')
                      toast.show('API-Key gespeichert und geprüft', 'success')
                    },
                    onError: (err: unknown) => setKeyError(err instanceof Error ? err.message : 'Key wurde abgelehnt'),
                  },
                )
              }
            >
              {saveApiKey.isPending ? 'Wird geprüft …' : apiKey?.configured ? 'Ersetzen' : 'Speichern'}
            </Button>
            {apiKey?.configured && (
              <Button
                variant="text"
                icon="delete"
                disabled={saveApiKey.isPending}
                onClick={() =>
                  saveApiKey.mutate(
                    { key: '' },
                    { onSuccess: () => toast.show('API-Key entfernt', 'success'), onError: (e) => setKeyError(e.message) },
                  )
                }
              >
                Entfernen
              </Button>
            )}
          </div>
          {keyError && <p className="opt-error" role="alert">{keyError}</p>}
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            Der Key wird vor dem Speichern gegen die API geprüft, verschlüsselt abgelegt
            und nie wieder ausgegeben — auch nicht an dich.
          </div>
        </div>

        {apiKey?.configured && apiKey.models.length > 0 && (
          <div className="field">
            <label htmlFor="anthropic-model">Modell</label>
            <div className="row">
              <Select
                id="anthropic-model"
                className="grow"
                value={apiKey.model}
                onChange={(v) =>
                  saveApiKey.mutate(
                    { model: v },
                    { onSuccess: () => toast.show('Modell gespeichert', 'success') },
                  )
                }
                /* Der Preis gehört in die Zeile: er ist der Grund, aus dem
                   man hier überhaupt wählt. */
                options={apiKey.models.map((m) => ({
                  value: m.id,
                  label: `${m.label} — $${m.input_per_mtok}/$${m.output_per_mtok} je Mio. Tokens`,
                }))}
              />
            </div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Preise als Schätzung: Listenpreise pro Million Tokens (Eingabe/Ausgabe),
              Stand {apiKey.pricing_state}. Die Kosten in den Statistiken werden daraus
              berechnet — die API meldet selbst keinen Preis.
            </div>
          </div>
        )}
        {(apiKey?.configured || cliReady) && <Button variant="tonal" icon="arrow_forward" onClick={() => document.getElementById('ai-github')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Weiter zu GitHub</Button>}
      </div>

  )
}
