# cue

**Prompt-Queue für Claude-Code-Sessions** — multi-tenant (Google-Login), Material Design 3 Expressive.

`cue` (≈ *queue*, „Stichwort zum Handeln") ist eine durchdachte Prompt-/Todo-Queue:
geplante Claude-Code-Prompts erfassen, nach Projekt/Repo gruppieren, über einen
Status-Workflow (Queued → Running → Done) abarbeiten und mit einem Klick in die
Claude-Code-CLI kopieren. Löst lose `.txt`-Sammlungen ab.

## Features

- **Kanban-Board** mit Drag-zwischen-Spalten (Statuswechsel) + Reorder, optimistisch, Spring-Motion.
- **Listenansicht** nach Status **gruppiert + ein-/aufklappbar**; Status dezent farbcodiert (grüner Haken = Done usw.).
- **Bookmarks**: Prompts mit einem Klick anpinnen; eigener Tab zeigt alle Bookmarks, **per Drag & Drop frei sortierbar**.
- **„Getestet"-Status**: für Running-/Done-Prompts markieren, ob das Feature schon getestet wurde (grün gefülltes, animiertes Icon).
- **1-Klick-Copy** auf jeder Karte + im Detail, mit Toast (optional Status `queued → running`); **Doppelklick** auf Karte/Listenzeile kopiert ebenfalls.
- **Im Dialog** selektiert `Cmd/Ctrl+A` nur den Prompt (nicht die Seite dahinter); `Cmd/Ctrl+C` kopiert ihn — direkt auch ohne Auswahl.
- **Projekt/Repo-Gruppierung** mit farbcodierten Badges + Filter-Chips; neuer Prompt übernimmt das zuletzt genutzte Projekt.
- **Composer** (FAB → Container-Transform) mit Markdown-Editor, Live-Preview, Autosave-Draft, **Tag-Autocomplete** (kuratierte EN-Dev-Tags + bereits verwendete Tags).
- **Import** von `.txt` (Split an `---`/Leerzeilen/keiner) + **Export** als JSON-Backup oder ZIP (`.txt` pro Prompt).
- **MD3 Expressive**: Material-You-Dynamic-Color aus Seed, Light/Dark/System, sichtbare Physik, reduced-motion-aware.
- **PWA**, installierbar, letzte Daten offline lesbar.
- **Tastatur-Shortcuts** (`n` neu · `/` Suche · `c` kopieren · `j/k` Navigation · `e` editieren · `1/2/3` Status · `?` Overlay).
- **Multi-Tenant**: Login via **Google OAuth** (Authorization-Code-Flow), jeder Nutzer hat eigene Prompts/Projekte; Zugang per E-Mail-/Domain-Allowlist.
- **Sicherheit**: signierte HttpOnly/Secure/SameSite=Strict-Session (Client-Secret bleibt serverseitig), CSRF-Double-Submit, OAuth-State-Schutz, strikte CSP + Security-Header.

## Tech-Stack

- **Backend**: Python 3.12, FastAPI, SQLModel (SQLAlchemy 2.0 + Pydantic), SQLite (WAL). Auth: argon2-cffi, itsdangerous.
- **Frontend**: React 18 + TypeScript + Vite, `motion` (Spring-Physik), `@dnd-kit`, `@tanstack/react-query`, `vite-plugin-pwa`.
- **Serving**: FastAPI serviert die gebaute `dist/` + die API unter `/api` — ein Container, ein Port.

## Lokale Entwicklung

```bash
# 1) Backend (Terminal A)
cd backend
uv venv && uv pip install -e ".[dev]"     # oder: pip install -r requirements.txt
export CUE_DEV=1                           # erlaubt Start ohne gesetzten Hash/Secret
export COOKIE_SECURE=false                 # http im Dev
uv run uvicorn app.main:app --reload --port 8000

# 2) Frontend (Terminal B) — proxyt /api auf :8000
cd frontend
pnpm install
pnpm dev                                   # http://localhost:5173
```

### Google OAuth einrichten

In der Google Cloud Console einen **OAuth-Client (Webanwendung)** anlegen:
- **Autorisierte JavaScript-Quellen**: `https://cue.celox.io`
- **Autorisierte Weiterleitungs-URIs**: `https://cue.celox.io/api/auth/google/callback`

Client-ID + Secret nach `.env` (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) — niemals committen.
Wer rein darf, steuern `GOOGLE_ALLOWED_EMAILS` / `GOOGLE_ALLOWED_DOMAINS`. `OWNER_EMAIL`
übernimmt beim ersten Login die bestehenden (noch besitzerlosen) Daten.

Im Dev (`CUE_DEV=1`) ist die Konfigurationsprüfung gelockert und die Allowlist offen.

`SECRET_KEY` erzeugen: `openssl rand -hex 32`.

### Tests

```bash
cd backend && uv run pytest          # Login → CRUD → Reorder → Import → Export
cd frontend && pnpm typecheck        # tsc
```

## Deployment (VPS, `cue.celox.io`)

```bash
# 1) .env anlegen (aus .env.example), Hash + Secret eintragen, COOKIE_SECURE=true.
#    ACHTUNG: docker compose interpoliert env_file — jedes '$' im Argon2-Hash
#    MUSS zu '$$' verdoppelt werden (siehe .env.example).
cp .env.example .env && nano .env

# 2) Bauen + starten (Frontend wird im Multi-Stage-Build mitgebaut).
docker compose up -d --build

# Container lauscht auf 127.0.0.1:8791 — Reverse-Proxy davorklemmen:
#   Caddy:  deploy/Caddyfile   (Auto-TLS)
#   nginx:  deploy/nginx.conf  (+ certbot --nginx -d cue.celox.io)
```

Hinter dem Proxy bleibt `COOKIE_SECURE=true` und `TRUST_PROXY=true` (der Proxy setzt
`X-Forwarded-For`). HSTS macht der Proxy.

### Backup & Restore

Die gesamte App-State liegt in einer SQLite-Datei im `cue-data`-Volume (`/data/cue.db`).

```bash
# Backup (Hot-Copy ist mit WAL sicher)
docker compose exec cue sh -c 'cp /data/cue.db /data/cue-backup.db'
docker cp cue:/data/cue-backup.db ./cue-backup-$(date +%F).db

# Restore
docker compose down
docker cp ./cue-backup.db cue:/data/cue.db   # Volume muss existieren
docker compose up -d
```

Alternativ jederzeit über die UI: **Settings → JSON-Backup / ZIP-Export** (pro Konto).

## Konto / Abmelden

Login & Identität laufen komplett über Google. **Settings → Konto** zeigt das angemeldete
Konto und bietet **Abmelden**. Zugang wird zentral über die Allowlist in der `.env` gesteuert.

## Projektstruktur

```
backend/    FastAPI + SQLModel API, Google-OAuth/Security, Import/Export, Tests
frontend/   React + TS + Vite, MD3-Expressive-UI, dnd-kit Board, PWA
deploy/     Caddyfile + nginx.conf
Dockerfile  Multi-Stage (node build → python runtime)
```

---

© 2026 Martin Pfeffer | celox.io
