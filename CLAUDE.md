# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cue` — a multi-tenant prompt-/todo-queue web app for managing Claude-Code-CLI prompts.
Capture prompts, group by project, work them through a status workflow (Queued →
Running → Done, plus Failed/Archived), and copy them into the CLI with one click.
Deployed at `https://cue.celox.io` behind a reverse proxy. Repo: `pepperonas/cue` (private).

Hard constraints: **multi-tenant** — sign in with **Google OAuth**, each user owns their own
projects/prompts (`User` table + `user_id` FK on every owned row), access gated by an
email/domain allowlist. MD3 Expressive design with real spring motion, footer
`© 2026 Martin Pfeffer | celox.io` on every page.

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
# Auth needs GOOGLE_CLIENT_ID/SECRET + an allowlist in .env (see .env.example).
```

After backend or frontend changes, run `uv run pytest` and `pnpm build` before committing.

## Architecture

**One process, one port.** FastAPI mounts the JSON API as a sub-app at `/api` and serves
the built frontend (`STATIC_DIR`, default `static/`) as a SPA for all other paths, with an
`index.html` fallback so client-side state survives hard reloads. In dev the two run
separately and Vite proxies `/api` to `:8000`.

**Backend (`backend/app/`)**
- `main.py` — app assembly, lifespan (`init_db`), security-header + CSP middleware, `/api` mount, SPA static serving (with path-traversal guard).
- `config.py` — env-driven `Settings` (cached). `validate()` fails fast (needs `SECRET_KEY` + `GOOGLE_CLIENT_ID`/`SECRET`) unless `CUE_DEV=1`. `is_email_allowed()` enforces the allowlist (empty lists = closed in prod, open in dev). `google_redirect_uri` derives from `ALLOWED_ORIGIN`.
- `db.py` — SQLite engine; a `connect` event sets `WAL`, `foreign_keys=ON`, `busy_timeout`. `init_db` runs `_migrate()` — idempotent `ALTER TABLE` (PRAGMA-guarded) for additive columns (`bookmarked`, `bookmark_order`, and `user_id` on `prompt`/`project`), since `create_all` only adds missing *tables*, never columns (no Alembic).
- `models.py` — `User` + `Project` + `Prompt` (SQLModel tables). `PromptStatus` enum. Every owned row has a `user_id` FK to `user`; `Prompt.bookmarked`/`bookmark_order` back the bookmarks section; `Prompt.tested` flags whether a running/done prompt's feature was tested. Project name uniqueness is **per user**, not global.
- `schemas.py` — Pydantic request/response models (kept separate from table models). `MeResponse` carries `UserRead`.
- `security.py` — itsdangerous signers: session tokens (payload carries `uid` + the CSRF secret), CSRF double-submit check, and short-lived OAuth-`state` tokens (`issue_oauth_state`/`oauth_state_valid`) to guard the Google redirect. No passwords.
- `deps.py` — `current_session` (401 guard), `current_user_id` (extracts `uid` from the session — inject this into every data router to scope by tenant), `require_csrf` (403 guard + Origin check), `get_client_ip`.
- `routers/` — `auth` (Google OAuth), `projects`, `prompts`, `importexport`. **Every data query is filtered by `user_id`; ownership is re-checked on get/update/delete (404 if not owned).**

**Auth (Google OAuth, Authorization Code flow)** — `routers/auth.py`:
- `GET /auth/google/login` → signs a `state`, sets it as a `SameSite=Lax` cookie (must survive Google's top-level redirect back), 302s to Google's consent screen.
- `GET /auth/google/callback` → validates `state` vs the cookie, exchanges the `code` for an access token (`oauth2.googleapis.com/token`, with the client secret), fetches the profile (`openidconnect.googleapis.com/v1/userinfo`). Both calls are stdlib `urllib` over TLS, so no id-token signature check and **no extra runtime dependency**. Rejects unverified emails and anyone failing the allowlist. Upserts the `User` by `google_sub`, issues the session, and — for `OWNER_EMAIL`'s first login — claims all `user_id IS NULL` rows (the original single-user data).
- `GET /auth/me` → `{authenticated, csrf_token, user}`. `POST /auth/logout` clears cookies.
- The session cookie stays `SameSite=Strict`; only the transient `state` cookie is `Lax`. Session salt is `v2` (carries `uid`), so old single-user sessions are invalidated.

**Frontend (`frontend/src/`)**
- `lib/color.ts` — Material-You tonal-palette generator from a seed hex (HSL-tone approximation, no heavy dep); `buildSchemes` → light/dark role tokens applied as `--md-*` CSS vars.
- `lib/motion.ts` — MD3 spring presets; all motion respects `prefers-reduced-motion`.
- `lib/api.ts` — typed fetch client; reads `cue_csrf` cookie and sends `X-CSRF-Token` on mutations.
- `lib/markdown.ts` — tiny escape-first Markdown renderer for previews (no DOMPurify needed: HTML is escaped before the markdown subset is applied).
- `lib/tags.ts` — curated English software-dev tag list (`DEV_TAGS`) backing the tag autocomplete.
- `components/TagInput.tsx` — comma-separated tag field with type-ahead. Completion targets the token after the last comma; `↑/↓` navigate, `Enter`/`Tab`/click commit, `Esc` closes. The Composer feeds it a pool of tags already used across prompts (via `usePrompts`) first, then `DEV_TAGS`, deduped case-insensitively. The suggestion list **flips upward** (`.tag-suggest.up`, decided from the input's viewport rect in `recalcDirection`) when there isn't room below — the tag field is the dialog's last field, so a downward menu would otherwise cover the "Anlegen"/"Abbrechen" action buttons. (A sticky action footer was tried and rejected: pinning it to the sheet bottom made it overlap the focused tag input.)
- `state/queries.ts` — React Query hooks with optimistic updates + rollback (reorder/update/delete).
- `state/settings.tsx` — theme (light/dark/system), seed color, behavior prefs; persisted to localStorage, applied as CSS vars.
- `state/toast.tsx` — toast provider.
- `components/Board.tsx` — dnd-kit multi-container board (cross-column status change + reorder). Local container state syncs from server data except while dragging; `onDragEnd` builds a minimal reorder payload for the affected columns.
- `components/MergeDialog.tsx` — merge several prompts into one: reorderable source list (↑/↓, remove), format choice (titles-as-headings / `---` rule / blank line), live markdown preview, smart prefills (title defaults to the source titles joined `A [&] B` and follows reordering until edited; union of tags; common project), and what to do with the originals (delete/archive/keep). Confirm → `POST /prompts/merge` (`useMergePrompts`). Selection itself is App state (`selectMode` + ordered `selectedIds`); cards/list rows show a checkbox and toggle selection instead of opening, drag is disabled while selecting, and a fixed `.select-bar` offers "Zusammenführen" (≥2).
- `components/BookmarksView.tsx` — the **Bookmarks** tab: a single drag-sortable column (dnd-kit `SortableContext`, reuses `PromptCard`) of all `bookmarked` prompts ordered by `bookmark_order`. Local order syncs from server except while dragging; `onDragEnd` → `arrayMove` → `POST /prompts/bookmarks/reorder` (optimistic via `useReorderBookmarks`). Bookmarking elsewhere (card/list/detail bookmark toggle → `PATCH {bookmarked}`) appends to the end of this section server-side.
- `components/ListView.tsx` — list view grouped by status into **collapsible** sections (one per visible status, driven by the same `columns` prop as the board, so the "Failed / Archived" toggle applies here too). Collapse state per status persists in `localStorage` (`cue-list-collapsed`); section bodies animate height with `emphasized` (reduced-motion → instant). Status icons are tinted via `STATUS_CLASS` (`.st-queued/.st-running/.st-done/.st-failed/.st-archived` in `global.css`) — the same subtle tint is applied to the board column heads, cards, and detail sheet.
- `App.tsx` — auth gate, filters/search, keyboard shortcuts, view switching, mounts Composer/Detail/Confirm/Shortcuts overlays. The active view (`board/list/bookmarks/projects/settings`) persists to `localStorage` (`cue-view`) and the active project filter to `cue-project-filter` (reset to `all` if that project was since deleted) — both restored on reload.
- `components/ToggleIconButton.tsx` — generic animated icon toggle (tints + fills when active, icon `motion.span` keyed by state so it pops on every flip; reduced-motion → instant). `BookmarkButton` (gold, `bookmark`/`bookmark_border`) and `TestedButton` (green, `verified` with `FILL` axis via `.tested-btn.active`) are thin wrappers. The tested toggle is only rendered for **running/done** prompts (card actions, list rows, detail header), backed by `Prompt.tested`.

## Conventions & gotchas

- **Status transitions**: entering `running`/`done` the first time stamps `ran_at` server-side (in both `PATCH /prompts/{id}` and `/prompts/reorder`). Reorder runs in one transaction.
- **Title derivation**: empty title → derived from the first non-blank body line (leading `#` stripped), server-side in `_derive_title`.
- **Merge**: `POST /prompts/merge {source_ids, title, body, project_id, status, tags, originals}` creates the merged prompt and deletes/archives/keeps the sources in one commit (the client composes body/order/format). Requires ≥2 owned sources.
- **Tenant scoping**: every data router depends on `current_user_id` and filters all reads + re-checks ownership on writes (404 if a row isn't the caller's). New rows always set `user_id`. When adding endpoints, never trust a client-supplied id without an ownership check.
- **Google OAuth secrets**: `GOOGLE_CLIENT_SECRET` (+ `GOOGLE_CLIENT_ID`) live only in `/opt/cue/.env`, never committed, never sent to the browser. The frontend just links to `/api/auth/google/login` (server builds the Google URL). The Google console needs origin `https://cue.celox.io` and redirect URI `https://cue.celox.io/api/auth/google/callback`.
- **Allowlist**: `GOOGLE_ALLOWED_EMAILS` / `GOOGLE_ALLOWED_DOMAINS` (comma lists). Both empty → nobody can sign in in prod (open access only under `CUE_DEV=1`).
- **CSRF secret lives inside the signed session token** — there is no separate server-side store; the readable `cue_csrf` cookie just mirrors it for the double-submit header.
- **Security headers + CSP** are set in middleware in `main.py`; HSTS is the proxy's job. CSP allows Google Fonts + inline styles (needed for runtime dynamic-color vars).
- **JSX + German quotes**: a straight `"` inside a `"..."` JSX attribute terminates it — use `{'…„…"…'}` (a JS string expression) for German-quoted attribute text.
- **tsconfig**: `tsconfig.node.json` is a composite referenced project and must NOT set `noEmit` (breaks `tsc -b`).
- **Copy interactions**: every prompt is one-click copyable (mini copy button on cards/list rows — styled `.copy-btn`, filled primary like the detail's big copy button; plus the big button in the detail) and **double-click** on a board card or list row copies it. A single click opens the detail, so a 200 ms timer in `PromptCard`/`ListView`'s `ListRow` discriminates click-vs-double-click (double click cancels the pending open — no detail flash).
- **Scoped select-all in dialogs**: `DetailSheet`/`Composer`-preview install a `window` keydown listener so `Cmd/Ctrl+A` selects **only** the prompt content (`Range.selectNodeContents` on a ref'd wrapper), not the whole page behind the scrim; `Cmd/Ctrl+C` then copies just that. In the detail, a bare `Cmd/Ctrl+C` with no active selection copies the full prompt. The composer **edit** textarea keeps native select-all (the listener only attaches in preview). The global shortcut handler in `App.tsx` early-returns on any meta/ctrl/alt combo, so these never collide.
- **Last-used project**: creating a prompt stores its project in `localStorage` (`cue-last-project`); the next new prompt preselects it (validated against the live project list; an active project filter still wins via `defaultProjectId`).
- **kbd-in-button legibility**: `.btn kbd` derives its chip background/border from `currentColor` (`color-mix`) so the `⌘↵` hint stays readable on filled/tonal/danger surfaces instead of dark-on-dark.
- **Conventional Commits**. Persist app state lives entirely in the SQLite file (`/data/cue.db` in the container volume).

## Deployment (live: cue.celox.io on VPS 69.62.121.168)

- Code at `/opt/cue` (rsync'd, no git clone). Container `cue` via `docker compose`, binds `127.0.0.1:8791`. nginx block `/etc/nginx/sites-enabled/cue.celox.io` (certbot-managed cert + HTTP→HTTPS redirect). Update: `rsync ./ root@69.62.121.168:/opt/cue/` then `ssh ... 'cd /opt/cue && docker compose up -d --build'`.
- **Frontend Docker stage pins pnpm@10.2.1** (`corepack prepare pnpm@10.2.1 --activate`); bare `corepack enable` pulls pnpm 11.x which needs Node 22+ and crashes on the Node 20 base.
- **`$$`-escape gotcha**: docker compose interpolates `env_file`, so any literal `$` in an `.env` value must be doubled to `$$` (relevant if a Google secret ever contains `$`). Running uvicorn directly uses values verbatim.

---

© 2026 Martin Pfeffer | celox.io
