# Architektur

Wie die Teile zusammenhängen — und warum sie so geschnitten sind. Für die
tägliche Arbeit am Code ist [`../CLAUDE.md`](../CLAUDE.md) die ausführlichere
Referenz; dieses Dokument ist die Übersicht davor.

## Das Ganze auf einen Blick

```
┌───────────────────────────────────────────────────────────┐
│  Browser (PWA)                                            │
│  React 18 · TypeScript · Vite · TanStack Query · dnd-kit  │
└───────────────┬───────────────────────────────────────────┘
                │  HTTPS, Cookie-Session + CSRF-Header
                │  1 dauerhaft offene Anfrage (Live-Sync)
┌───────────────▼───────────────────────────────────────────┐
│  Ein Container, ein Port (127.0.0.1:8791)                 │
│                                                            │
│   FastAPI                                                  │
│    ├── /api/…      JSON-API (Sub-App)                      │
│    └── /*          gebautes Frontend + SPA-Fallback        │
│                                                            │
│   SQLite (WAL)  ── /data/cue.db  ── einziger Zustand       │
└───────────────▲───────────────────────────────────────────┘
                │  Bearer RUNNER_TOKEN, Long-Poll (bis 25 s)
┌───────────────┴───────────────────────────────────────────┐
│  cue-runner (Mac, dort wo `claude` angemeldet ist)        │
│  Runs · Prompt-Optimierung · CLI-Delivery · Capture        │
└───────────────────────────────────────────────────────────┘
```

Drei Entscheidungen prägen alles Weitere:

**Ein Prozess, ein Port.** FastAPI hängt die API als Sub-App unter `/api` ein
und liefert daneben das gebaute Frontend aus, mit `index.html`-Fallback, damit
ein harter Reload den Client-State nicht verliert. Kein zweiter Webserver, kein
CORS, keine getrennte Deploy-Reihenfolge. Im Dev laufen beide getrennt und Vite
proxyt `/api` auf `:8000`.

**Der Server ruft niemals eine Shell auf.** Alles, was die Claude-Code-CLI
braucht — Runs, Prompt-Optimierung, Tippen in eine laufende Session —, holt sich
ein Daemon auf dem Mac ab, auf dem `claude` angemeldet ist. Der VPS hat weder
die CLI noch deren Zugangsdaten. Deshalb sind diese Funktionen **owner-only**:
sie führen Code auf einer fremden Maschine aus.

**Der Zustand ist eine Datei.** Eine SQLite-Datei im Volume ist das ganze
Backup: `sqlite3 .backup` (nie `cp` — das WAL hält bestätigte Transaktionen, die
noch nicht in der Hauptdatei stehen).

## Backend (`backend/app/`)

| Modul | Aufgabe |
| --- | --- |
| `main.py` | App-Zusammenbau, Lifespan, Security-Header + CSP, `/api`-Mount, SPA-Auslieferung, Hintergrund-Schleifen |
| `config.py` | env-getriebene `Settings` (gecacht). `validate()` bricht beim Start ab, wenn Pflichtwerte fehlen |
| `db.py` | SQLite-Engine (WAL, `foreign_keys=ON`, `busy_timeout`), idempotente Migrationen |
| `models.py` | SQLModel-Tabellen — jede besitzte Zeile hat `user_id` |
| `schemas.py` | Pydantic-Request/Response, bewusst getrennt von den Tabellen |
| `security.py` | Signierte Session-Token, CSRF-Double-Submit, OAuth-`state` |
| `deps.py` | `current_user_id` (Mandant), `require_csrf`, `require_owner`, `require_runner` |
| `routers/` | ein Modul je Domäne — jede Abfrage nach `user_id` gefiltert |

### Datenmodell

18 Tabellen. Der Kern:

```
User ──┬── Project ──┐
       ├── Prompt ───┴── PromptTag ── Tag
       ├── Snippet ── SnippetGroup
       ├── CaptureSession ── CapturedPrompt
       └── Run ── RunStep · RunLog
```

Zwei Muster wiederholen sich und sind wichtig zu kennen:

**Denormalisierte Spalten mit genau EINEM Schreiber.** `Prompt.tags` (Komma-
String) ist ein Cache über `prompt_tag`; einziger Schreiber ist `TagService`.
Ebenso `Snippet.group_name`. Der Vorteil: Liste, Suche, Export und Clients
bleiben unverändert einfach. Die Bedingung: nie direkt schreiben.

**Abgeleitet statt gemerkt.** Der Live-Sync-Cursor ist kein Zähler, sondern ein
Fingerabdruck über die Daten (`app/changes.py`) — an einen Zähler denkt man beim
nächsten neuen Schreibpfad nicht mehr, an einen abgeleiteten Wert muss man nicht
denken. Aus demselben Grund ist `Prompt.edited_at` nicht `updated_at`: letzteres
bewegt sich bei jedem Schreibvorgang, auch bei einem Drag.

### Mandantentrennung

Jeder Datenrouter hängt an `current_user_id` und filtert **jede** Abfrage
danach; bei `GET`/`PATCH`/`DELETE` wird der Besitz erneut geprüft. Ein fremder
Datensatz ergibt **404, nie 403** — „verboten" würde bestätigen, dass die Zeile
existiert.

Das ist nicht der Disziplin überlassen: `backend/tests/test_tenancy.py` läuft
über **jede** Route der App und schlägt fehl, wenn eine weder nach
`current_user_id` filtert noch eine Maschine authentifiziert noch mit einer
schriftlichen Begründung in `UNSCOPED_BY_DESIGN` steht.

## Frontend (`frontend/src/`)

| Ordner | Inhalt |
| --- | --- |
| `lib/` | **reine Module** — hier liegt die testbare Logik (Sortierung, Tags, Tastenlogik, Markdown, Diff, Live-Sync, Farben) |
| `components/` | React-Komponenten. Bewusst **nicht** getestet |
| `state/` | React-Query-Hooks, Einstellungen, Overlay-Stack, Toasts |
| `styles/` | MD3-Expressive-Tokens + globales CSS |

Die Trennung ist die Testpolitik: **wenn testenswerte Logik in einem Hook oder
einer Komponente feststeckt, wird sie herausgezogen**, statt einen Renderer zu
testen. `lib/live-sync.ts` exportiert die komplette Polling-Schleife
framework-frei, `lib/tag-keys.ts` die Tastentabelle des Tag-Feldes — die
zugehörigen Hooks sind danach nur noch Verdrahtung.

## Wie eine Änderung auf allen Geräten ankommt

Jeder Browser hält **eine** Anfrage offen: `GET /api/changes?since=<cursor>`.
Der Server prüft im Sekundentakt, ob sich der Fingerabdruck geändert hat, und
antwortet dann — gemessen 0,18 s nach der Änderung. Passiert nichts, kostet die
Verbindung nichts.

Drei Randbedingungen halten das zusammen:

1. Die Wartezeit (25 s) muss klar unter dem `proxy_read_timeout` des Reverse
   Proxy liegen (nginx: 60 s), sonst kappt der Proxy die Verbindung vor der
   Antwort.
2. Der Endpunkt nimmt **kein** `Depends(get_session)` — eine parkende Anfrage
   darf keine Verbindung aus dem Pool (5 Stück) belegen.
3. Im Hintergrund-Tab ruht die Schleife und holt beim Zurückkehren in einer
   einzigen Anfrage auf.

Dieselbe Long-Poll-Mechanik trägt die drei Claim-Endpunkte des Runners; sie hat
den Leerlauf-Verkehr um etwa das Zehnfache gesenkt und die Übernahme dabei
*schneller* gemacht.

## Der Runner (`cue-runner/`)

Ein asyncio-Daemon auf dem Mac mit vier Schleifen: Runs übernehmen,
CLI-Deliveries, Optimierungen und der Capture-Weiterleiter. Er wird **nicht**
auf den VPS ausgerollt.

- **Runs** — ein `Run` ist `single` oder `chain`; eine Kette fädelt alle
  Schritte in *eine* Claude-Session (`--session-id`, dann `--resume`). Jeder
  `RunStep` hält den Prompt-Text als Momentaufnahme fest, damit ein Lauf
  reproduzierbar bleibt.
- **Übernahme ist atomar** — ein einzelnes `UPDATE … WHERE status='queued' …
  RETURNING id`. Zwei Runner können denselben Job nicht doppelt bekommen.
- **Pfade sind auf eine Whitelist beschränkt** (`ALLOWED_PROJECT_BASES`),
  serverseitig **und** noch einmal im Runner.
- **Herrenlose Läufe werden eingesammelt**: `reap_stale()` beendet Läufe, deren
  Herzschlag älter ist als `RUN_STALE_TIMEOUT`, und räumt damit auch auf, was
  ein Backend-Neustart mitten im Lauf hinterlassen hat.

## Prompt-Capture, in beide Richtungen

**Hinein**: ein `UserPromptSubmit`-Hook schreibt jeden in der CLI getippten
Prompt in eine Spool-Datei, der Weiterleiter des Runners schickt ihn an
`POST /api/capture`. Das Projekt wird aus dem **Git-Root** unterhalb von
`CAPTURE_BASE` abgeleitet, wobei Gruppierungsordner mit `_`-Präfix übersprungen
werden.

**Hinaus**: derselbe Hook merkt sich den Terminal-Kontext (iTerm2-GUID bzw.
tmux-Pane). Damit kann cue einen Prompt in eine **laufende** Session tippen —
über AppleScript bzw. `tmux paste-buffer`, beides mit *bracketed paste*, damit
mehrzeilige Prompts als Text ankommen und nicht als Kommandos.

## Weiterlesen

- [`CONFIGURATION.md`](CONFIGURATION.md) — jede Umgebungsvariable
- [`API.md`](API.md) — alle Endpunkte
- [`TESTING.md`](TESTING.md) — wie hier getestet wird und warum so
- [`../SECURITY.md`](../SECURITY.md) — Sicherheitsmodell
- [`../CLAUDE.md`](../CLAUDE.md) — die Fallstricke im Detail
