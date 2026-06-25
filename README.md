# cue

**Prompt-Queue für Claude-Code-Sessions** — single-user, Material Design 3 Expressive.

`cue` (≈ *queue*, „Stichwort zum Handeln") ist eine durchdachte Prompt-/Todo-Queue:
geplante Claude-Code-Prompts erfassen, nach Projekt/Repo gruppieren, über einen
Status-Workflow (Queued → Running → Done) abarbeiten und mit einem Klick in die
Claude-Code-CLI kopieren. Löst lose `.txt`-Sammlungen ab.

## Features

- **Kanban-Board** mit Drag-zwischen-Spalten (Statuswechsel) + Reorder, optimistisch, Spring-Motion.
- **1-Klick-Copy** auf jeder Karte + im Detail, mit Toast (optional Status `queued → running`).
- **Projekt/Repo-Gruppierung** mit farbcodierten Badges + Filter-Chips.
- **Composer** (FAB → Container-Transform) mit Markdown-Editor, Live-Preview, Autosave-Draft.
- **Import** von `.txt` (Split an `---`/Leerzeilen/keiner) + **Export** als JSON-Backup oder ZIP (`.txt` pro Prompt).
- **MD3 Expressive**: Material-You-Dynamic-Color aus Seed, Light/Dark/System, sichtbare Physik, reduced-motion-aware.
- **PWA**, installierbar, letzte Daten offline lesbar.
- **Tastatur-Shortcuts** (`n` neu · `/` Suche · `c` kopieren · `j/k` Navigation · `e` editieren · `1/2/3` Status · `?` Overlay).
- **Sicherheit**: Argon2id, signierte HttpOnly/Secure/SameSite=Strict-Session, CSRF-Double-Submit, Login-Ratelimit, strikte CSP + Security-Header.

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

Im Dev-Modus (`CUE_DEV=1`) ohne gesetzten `APP_PASSWORD_HASH` schlägt der Login fehl —
erzeuge zuerst einen Hash (siehe unten) und exportiere ihn, oder setze ihn in einer `.env`.

### Passwort-Hash erzeugen

```bash
python scripts/gen_password_hash.py
# Gibt eine Zeile  APP_PASSWORD_HASH=...  aus → in .env eintragen.
```

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

Alternativ jederzeit über die UI: **Settings → JSON-Backup / ZIP-Export**.

## Passwort ändern

**Settings → Passwort ändern** erzeugt aus dem neuen Passwort einen Argon2id-Hash
(das Passwort wird nie gespeichert). Den ausgegebenen `APP_PASSWORD_HASH`-Wert in die
`.env` eintragen und den Container neu starten (`docker compose up -d`).

## Projektstruktur

```
backend/    FastAPI + SQLModel API, Auth/Security, Import/Export, Tests
frontend/   React + TS + Vite, MD3-Expressive-UI, dnd-kit Board, PWA
deploy/     Caddyfile + nginx.conf
scripts/    gen_password_hash.py
Dockerfile  Multi-Stage (node build → python runtime)
```

---

© 2026 Martin Pfeffer | celox.io
