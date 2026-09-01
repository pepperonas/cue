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

   … und daneben, für Nutzer mit eigenem API-Key:

┌───────────────────────────────────────────────────────────┐
│  In-Process-Optimierer im Container                        │
│  Messages API, bezahlt vom Key des jeweiligen Nutzers      │
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
die CLI noch deren Zugangsdaten.

Daraus folgt, wer was darf, und die Grenze verläuft entlang der **fremden
Maschine**, nicht entlang „ist wichtig": Runs und CLI-Delivery führen Code auf
dem Rechner des Betreibers aus und bleiben **owner-only**. Die
Prompt-Optimierung nicht mehr — sie hat seit 0.54.0 einen zweiten Weg, der
niemandes Maschine anfasst: einen HTTPS-Aufruf gegen die Messages API mit dem
**eigenen API-Key** des Nutzers, ausgeführt im Container. „Keine Shell" gilt
dort unverändert; „owner-only" wäre eine Einschränkung ohne Grund geworden.

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
| `deps.py` | `current_user_id` (Mandant), `require_csrf`, `require_owner` (fremde Maschine), `require_optimizer` (Besitzer **oder** eigener Key), `require_runner` |
| `routers/` | ein Modul je Domäne — jede Abfrage nach `user_id` gefiltert |
| `ordering.py` | wo eine gezogene Karte landet — **und** die Spaltenordnung, die der Client spiegelt |
| `stats.py` | die ganze Aggregation des Statistik-Tabs, FastAPI-frei und damit einzeln testbar |
| `secrets_store.py` | Verschlüsselung der fremden API-Keys (Fernet, Schlüssel aus `SECRET_KEY`) |
| `optimization/` | Service, Repository, Provider-Registry, Preistabelle, Meta-Prompt, In-Process-Executor |

### Datenmodell

18 Tabellen. Der Kern:

```
User ──┬── Project ──┐
       ├── Prompt ───┴── PromptTag ── Tag
       │     ├── PromptOptimization ── OptimizationBatch
       │     ├── PromptEvent   (überlebt seinen Prompt bewusst)
       │     └── Attachment
       ├── Snippet ── SnippetGroup · SnippetTombstone
       ├── CaptureSession ── CapturedPrompt · CliDelivery
       └── Run ── RunStep · RunLog
```

Zwei Muster wiederholen sich und sind wichtig zu kennen:

**Denormalisierte Spalten mit genau EINEM Schreiber.** `Prompt.tags` (Komma-
String) ist ein Cache über `prompt_tag`; einziger Schreiber ist `TagService`.
Ebenso `Snippet.group_name`. Der Vorteil: Liste, Suche, Export und Clients
bleiben unverändert einfach. Die Bedingung: nie direkt schreiben.

**Sortierrelevantes wird gespeichert, nicht gerechnet.** `Prompt` trägt neben
Status und `sort_order` vier Flaggen, die die Reihenfolge mitbestimmen —
`blocked`, `tested`, `test_closely` und `priority` — weil der Server dieselbe
Ordnung herstellen muss wie der Browser (siehe „Eine Regel, drei Spiegel").

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
framework-frei, `lib/tag-keys.ts` die Tastentabelle des Tag-Feldes,
`lib/detail-keys.ts` die des Detail-Dialogs, `lib/long-press.ts` die Buchführung
eines langen Drucks — die zugehörigen Hooks sind danach nur noch Verdrahtung.
Am Long-Press sieht man, warum: riskant daran ist nicht das Rendern, sondern
**genau einmal auslösen und den folgenden Klick schlucken** — sonst tut eine
Geste zwei Dinge.

**Eine einzige Adresse.** Es gibt kein Router-Paket und das ist keins im
Werden: jede Ansicht der App ist ein Zustandswert in `App.tsx`, die URL bleibt
`/`. Genau eine Sache braucht eine eigene Adresse — die **Landing-Page**
(`/willkommen`), weil die Adresse ihr Zweck ist: ein Link, den man verschickt,
eine Seite, auf der ein Reload bleibt, ein funktionierender Zurück-Knopf.
`lib/route.ts` hält die Regeln (rein, getestet, tolerant gegen Schrägstrich und
Groß-/Kleinschreibung), `state/route.ts` verdrahtet sie mit `popstate`.

⚠️ Das kollidiert **nicht** mit dem Overlay-Stack, obwohl beide an der History
hängen: dessen Einträge werden `history.pushState(state, '')` **ohne
URL-Argument** gepusht und bewegen den Pfad daher nie. Ein per Zurück-Geste
geschlossener Dialog erzeugt ein `popstate` mit unverändertem Pfad, und
`routeFrom` liefert dieselbe Route. Die beiden Historien sind **von der
Konstruktion her** unabhängig, nicht per Absprache.

Angemeldete Nutzer landen direkt in der App; die Landing-Page bleibt über einen
Kopfzeilen-Knopf jederzeit erreichbar und zeigt ihnen dann „Zur App" statt eines
Login-Knopfs. Sie trägt außerdem den OAuth-Fehler (`?auth_error=…`), auf den
Google zurückleitet.

**Ein Dialog, zwei Betriebsarten.** Das Prompt-Formular liegt in
`components/PromptEditor.tsx` und wird von zwei Wirten gerendert: vom
`Composer` (Anlegen) und vom `DetailSheet`, das beim Bearbeiten nur seinen
Inhalt austauscht, statt sich zu schließen und einen zweiten Dialog
aufzubauen. Der Editor rendert bewusst **drei direkte Kinder ohne eigenen
Container** — die Layoutregeln der Dialoge (`.sheet--x > *`) sprechen direkte
Kinder an, ein Wrapper ließe den Scrollbereich kollabieren.

## Eine Regel, drei Spiegel: die Spaltenordnung

In welcher Reihenfolge Karten in einer Spalte stehen, ist an **drei** Stellen
formuliert — und das ist kein Versehen, sondern die Konsequenz aus drei
verschiedenen Laufzeiten:

| Ort | Wofür |
| --- | --- |
| `backend/app/ordering.py` → `display_key` | wo eine gezogene Karte einsortiert wird (der Anker ist eine *sichtbare* Nachbarkarte) |
| `frontend/src/lib/order.ts` → `columnComparator` | was der Browser malt |
| `ordering.py` → `BOARD_ORDER_SQL` | das `ORDER BY`, mit dem `db._repair_sort_order` beim Start durchnummeriert |

Driften sie auseinander, wird ein Drag **gespeichert und tut trotzdem nichts** —
genau das ist hier schon passiert. Deshalb liegt der Vertrag als Datei vor:
`contracts/column-order.json` beschreibt 18 Fälle, und dieselben Fälle laufen in
`backend/tests/test_ordering_contract.py`, in
`frontend/src/lib/order.contract.test.ts` und zusätzlich einmal durch echtes
SQLite. Wer eine Regel ändert, ändert den Vertrag; wer nur eine Sprache anfasst,
bekommt zwei rote Suiten.

Die aktuelle Reihenfolge, von außen nach innen: **blockiert** ganz nach unten ·
in *Done* getestete Prompts unter die ungetesteten (eigene aufklappbare Sektion)
· in *Done* die mit **„genau testen"** nach oben · in *Queued* nach
**Priorität** (hoch, normal, gering) · dann die gezogene Ordnung (`sort_order`,
`id`).

Zwei Bedingungen gelten für **jede** neue Regel:

1. **Nur gespeicherte Felder.** Was der Server nicht sieht, kann er nicht
   spiegeln.
2. **Der Nutzer muss die Regel überstimmen können.** Priorität und „genau
   testen" erfüllen das — ein Klick bringt die Karte dorthin, wo sie hin soll.
   Eine Sortierung nach `ran_at` erfüllte es nicht und wurde deshalb entfernt:
   sie machte das Ziehen in diesem Block zu einem garantierten Nichts.

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

## Zwei Wege für die Optimierung — und wer sie bezahlt

Einen Prompt umschreiben zu lassen kostet Geld, und zwar echtes. Deshalb gibt es
seit 0.54.0 zwei Ausführungswege, die sich in **genau einem** Punkt
unterscheiden: wessen Konto belastet wird.

| Provider | Wo er läuft | Bezahlt von | Kosten kommen |
| --- | --- | --- | --- |
| `claude_cli` | Mac-Runner, `claude -p` | Betreiber (Claude-Code-Abo) | **gemeldet** von der CLI (`total_cost_usd`) |
| `anthropic_api` | im Container, Messages API | dem Nutzer, über seinen hinterlegten Key | **gerechnet** aus der Usage (`optimization/pricing.py`) |

Die Weiche steht am **Nutzer**, nicht an der Konfiguration:
`service.provider_for(uid)` liefert `anthropic_api`, sobald ein Key hinterlegt
ist, sonst den konfigurierten Standard. `providers.runner_ids()` filtert die
Claim-Abfrage des Runners, damit der Mac niemals einen Job übernimmt, der gegen
einen fremden API-Key laufen sollte — und umgekehrt.

**Warum die Kosten einmal gemeldet und einmal gerechnet werden**, obwohl das
inkonsistent aussieht: die CLI *nennt* den Preis, speichert aber unvollständige
Token (gecachter Input fehlt) — Preis × Token unterschätzt die Eingabeseite um
etwa das Fünfzigfache. Die Messages API macht es genau andersherum: vollständige
Usage, kein Preis. Beide Zahlen landen in derselben Spalte
`PromptOptimization.cost_usd`; die Statistik weist den Gesamtwert überall dort
als **Schätzung** aus, wo der gerechnete Weg beteiligt war, und nennt den Stand
der Preistabelle (`pricing.STATE`) dazu.

**Umgeschrieben wird der ganze Prompt, nicht nur sein Text.** Titel und
Schlagworte reisen als eigene Vorschläge mit (`optimized_title`,
`optimized_tags` auf der Versuchszeile, daneben die Momentaufnahmen
`original_title`/`original_tags`); die Schlagworte des Kontos gehen als
Vokabular in die Anfrage, damit das vorhandene Schema fortgeschrieben statt
durch Synonyme ergänzt wird.

⚠️ Zwei Regeln tragen das:

1. **Der Körper überlebt jede Antwortform.** Fehlt die Formatmarke, ist der
   ganze Text der Körper und es wird nichts vorgeschlagen — eine Antwort im
   alten Stil ist eine gute Optimierung und darf nicht an ihrer Verpackung
   scheitern.
2. **Ein leerer Vorschlag löscht nichts.** „Nichts vorgeschlagen" und „alles
   entfernen" sehen im Ergebnis gleich aus; nur eine der Lesarten ist
   verlustfrei. Server und Anzeige folgen hier derselben Regel, sonst zeigte
   die Oberfläche eine Änderung an, die nie geschrieben wird.

**Der Key liegt verschlüsselt** (`app/secrets_store.py`, Fernet, Schlüssel aus
`SECRET_KEY` abgeleitet) und verlässt den Server nie wieder — die API liefert nur
eine Vorschau der letzten vier Zeichen. Details in
[`../SECURITY.md`](../SECURITY.md).

**Die Rechte sind zweigeteilt**, weil Ausgeben und Lesen verschiedene Dinge
sind: einen Job *anstoßen* braucht `require_optimizer` (Besitzer oder eigener
Key), einen fertigen Vorschlag *lesen, übernehmen oder verwerfen* braucht nur
die Mandantenprüfung. Sonst hätte das Entfernen des eigenen Keys Vorschläge
gesperrt, die der Nutzer bereits bezahlt hat.

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

## Was das README über sich selbst weiß

Der Badge-Bereich ist **generiert, nicht gepflegt**: `scripts/update-badges.mjs`
misst nach jedem `npm test` das Repository und schreibt vier Blöcke neu — den
Hero (Version, Codegröße), die Badge-Wand, den Tech-Stack und die Testtabelle.

Die Trennung ist dieselbe wie im Frontend: die **Regeln** (jeder reguläre
Ausdruck über eine Werkzeugausgabe, jede Ableitung aus einem Manifest) liegen in
`scripts/badges-lib.mjs` und sind einzeln getestet; das Skript daneben ist nur
noch Holen und Schreiben. Der Grund ist der Fehlermodus: ein Muster, das
lautlos nicht mehr greift, macht aus jedem Badge eine selbstbewusste Lüge — und
Badges sind das Erste, was jemand liest.

## Weiterlesen

- [`CONFIGURATION.md`](CONFIGURATION.md) — jede Umgebungsvariable
- [`API.md`](API.md) — alle Endpunkte
- [`TESTING.md`](TESTING.md) — wie hier getestet wird und warum so
- [`../SECURITY.md`](../SECURITY.md) — Sicherheitsmodell
- [`../CLAUDE.md`](../CLAUDE.md) — die Fallstricke im Detail
