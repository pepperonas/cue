# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cue` — a single-user prompt-/todo-queue web app for managing Claude-Code-CLI prompts.
Capture prompts, group by project, work them through a status workflow (Queued →
Running → Done, plus Failed/Archived), and copy them into the CLI with one click.
Deployed at `https://cue.celox.io` behind a reverse proxy. Repo: `pepperonas/cue` (private).

Hard constraints: **single user** (one password, no user table), MD3 Expressive design
with real spring motion, footer `© 2026 Martin Pfeffer | celox.io` on every page.

## Commands

```bash
# Backend (from backend/)
uv venv && uv pip install -e ".[dev]"     # setup
uv run uvicorn app.main:app --reload --port 8000   # dev server (set CUE_DEV=1 COOKIE_SECURE=false)
uv run pytest                              # run all tests
uv run pytest tests/test_api.py::test_full_flow    # single test

# Frontend (from frontend/)
pnpm install
pnpm dev                                   # Vite dev server :5173, proxies /api -> :8000
pnpm build                                 # tsc -b && vite build -> dist/
pnpm typecheck

# Full app (prod): one container serves API + built frontend
docker compose up -d --build               # listens on 127.0.0.1:8791
python scripts/gen_password_hash.py        # produce APP_PASSWORD_HASH for .env
```

After backend or frontend changes, run `uv run pytest` and `pnpm build` before committing.

## Architecture

**One process, one port.** FastAPI mounts the JSON API as a sub-app at `/api` and serves
the built frontend (`STATIC_DIR`, default `static/`) as a SPA for all other paths, with an
`index.html` fallback so client-side state survives hard reloads. In dev the two run
separately and Vite proxies `/api` to `:8000`.

**Backend (`backend/app/`)**
- `main.py` — app assembly, lifespan (`init_db`), security-header + CSP middleware, `/api` mount, SPA static serving (with path-traversal guard).
- `config.py` — env-driven `Settings` (cached). `validate()` fails fast unless `CUE_DEV=1`.
- `db.py` — SQLite engine; a `connect` event sets `WAL`, `foreign_keys=ON`, `busy_timeout`.
- `models.py` — `Project` + `Prompt` (SQLModel tables). `PromptStatus` enum.
- `schemas.py` — Pydantic request/response models (kept separate from table models).
- `security.py` — Argon2id hashing/verify, itsdangerous session tokens (payload carries the CSRF secret), CSRF double-submit check, in-memory per-IP + global login rate limiters.
- `deps.py` — `current_session` (401 guard), `require_csrf` (403 guard + Origin check), `get_client_ip` (only trusts XFF when `TRUST_PROXY`, uses rightmost hop).
- `routers/` — `auth`, `projects`, `prompts`, `importexport`.

**Frontend (`frontend/src/`)**
- `lib/color.ts` — Material-You tonal-palette generator from a seed hex (HSL-tone approximation, no heavy dep); `buildSchemes` → light/dark role tokens applied as `--md-*` CSS vars.
- `lib/motion.ts` — MD3 spring presets; all motion respects `prefers-reduced-motion`.
- `lib/api.ts` — typed fetch client; reads `cue_csrf` cookie and sends `X-CSRF-Token` on mutations.
- `lib/markdown.ts` — tiny escape-first Markdown renderer for previews (no DOMPurify needed: HTML is escaped before the markdown subset is applied).
- `lib/tags.ts` — curated English software-dev tag list (`DEV_TAGS`) backing the tag autocomplete.
- `components/TagInput.tsx` — comma-separated tag field with type-ahead. Completion targets the token after the last comma; `↑/↓` navigate, `Enter`/`Tab`/click commit, `Esc` closes. The Composer feeds it a pool of tags already used across prompts (via `usePrompts`) first, then `DEV_TAGS`, deduped case-insensitively.
- `state/queries.ts` — React Query hooks with optimistic updates + rollback (reorder/update/delete).
- `state/settings.tsx` — theme (light/dark/system), seed color, behavior prefs; persisted to localStorage, applied as CSS vars.
- `state/toast.tsx` — toast provider.
- `components/Board.tsx` — dnd-kit multi-container board (cross-column status change + reorder). Local container state syncs from server data except while dragging; `onDragEnd` builds a minimal reorder payload for the affected columns.
- `components/ListView.tsx` — list view grouped by status into **collapsible** sections (one per visible status, driven by the same `columns` prop as the board, so the "Failed / Archived" toggle applies here too). Collapse state per status persists in `localStorage` (`cue-list-collapsed`); section bodies animate height with `emphasized` (reduced-motion → instant). Status icons are tinted via `STATUS_CLASS` (`.st-queued/.st-running/.st-done/.st-failed/.st-archived` in `global.css`) — the same subtle tint is applied to the board column heads, cards, and detail sheet.
- `App.tsx` — auth gate, filters/search, keyboard shortcuts, view switching, mounts Composer/Detail/Confirm/Shortcuts overlays.

## Conventions & gotchas

- **Status transitions**: entering `running`/`done` the first time stamps `ran_at` server-side (in both `PATCH /prompts/{id}` and `/prompts/reorder`). Reorder runs in one transaction.
- **Title derivation**: empty title → derived from the first non-blank body line (leading `#` stripped), server-side in `_derive_title`.
- **Password change** returns a new Argon2id hash; the operator must put it in `.env` and restart (secrets never touch the DB, the running process won't rewrite `.env`).
- **CSRF secret lives inside the signed session token** — there is no separate server-side store; the readable `cue_csrf` cookie just mirrors it for the double-submit header.
- **Security headers + CSP** are set in middleware in `main.py`; HSTS is the proxy's job. CSP allows Google Fonts + inline styles (needed for runtime dynamic-color vars).
- **JSX + German quotes**: a straight `"` inside a `"..."` JSX attribute terminates it — use `{'…„…"…'}` (a JS string expression) for German-quoted attribute text.
- **tsconfig**: `tsconfig.node.json` is a composite referenced project and must NOT set `noEmit` (breaks `tsc -b`).
- **Copy interactions**: every prompt is one-click copyable (mini copy button on cards/list rows, big button in the detail) and **double-click** on a board card or list row copies it. A single click opens the detail, so a 200 ms timer in `PromptCard`/`ListView`'s `ListRow` discriminates click-vs-double-click (double click cancels the pending open — no detail flash).
- **Scoped select-all in dialogs**: `DetailSheet`/`Composer`-preview install a `window` keydown listener so `Cmd/Ctrl+A` selects **only** the prompt content (`Range.selectNodeContents` on a ref'd wrapper), not the whole page behind the scrim; `Cmd/Ctrl+C` then copies just that. In the detail, a bare `Cmd/Ctrl+C` with no active selection copies the full prompt. The composer **edit** textarea keeps native select-all (the listener only attaches in preview). The global shortcut handler in `App.tsx` early-returns on any meta/ctrl/alt combo, so these never collide.
- **Last-used project**: creating a prompt stores its project in `localStorage` (`cue-last-project`); the next new prompt preselects it (validated against the live project list; an active project filter still wins via `defaultProjectId`).
- **kbd-in-button legibility**: `.btn kbd` derives its chip background/border from `currentColor` (`color-mix`) so the `⌘↵` hint stays readable on filled/tonal/danger surfaces instead of dark-on-dark.
- **Conventional Commits**. Persist app state lives entirely in the SQLite file (`/data/cue.db` in the container volume).

## Deployment (live: cue.celox.io on VPS 69.62.121.168)

- Code at `/opt/cue` (rsync'd, no git clone). Container `cue` via `docker compose`, binds `127.0.0.1:8791`. nginx block `/etc/nginx/sites-enabled/cue.celox.io` (certbot-managed cert + HTTP→HTTPS redirect). Update: `rsync ./ root@69.62.121.168:/opt/cue/` then `ssh ... 'cd /opt/cue && docker compose up -d --build'`.
- **Frontend Docker stage pins pnpm@10.2.1** (`corepack prepare pnpm@10.2.1 --activate`); bare `corepack enable` pulls pnpm 11.x which needs Node 22+ and crashes on the Node 20 base.
- **`$$`-escape gotcha**: docker compose interpolates `env_file`, so every literal `$` in `APP_PASSWORD_HASH` must be doubled to `$$` in `.env`. Running uvicorn directly uses the hash verbatim. Wrong escaping → the hash is mangled to `=19=65536,...` and login always fails with "Invalid password".

---

© 2026 Martin Pfeffer | celox.io
