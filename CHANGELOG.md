# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.5] - 2026-07-14

### Changed
- **Tag autocomplete: full-spectrum list** — another ~520 categorized entries
  (languages, frameworks, protocols/networking, systems/low-level, build
  tooling, editors, hardware/IoT, game dev, audio/video, docs, business/
  product, reliability/ops, data engineering, auth/identity, UI content,
  APIs/integration), total now ~1100. American spelling enforced by a new
  unit test (no -isation/colour/behaviour/…), list stays duplicate-free.
- Data fix: the typo tag `opimization` on 18 prompts was corrected to
  `optimization` (deduped where both were present).

## [0.15.4] - 2026-07-13

### Changed
- **Tag autocomplete: curated list massively extended** — ~500 new categorized
  software-development tags (UI components, UX/interaction incl. transition/gui,
  frontend/backend tech, security, testing, DevOps/cloud, AI, mobile, process,
  code quality, general engineering), programmatically deduplicated; a unit
  test now guarantees the list stays free of case-insensitive duplicates and
  single-token lowercase.

## [0.15.3] - 2026-07-13

### Changed
- **Tested prompts sink in Done**: toggling the tested icon on a Done card
  springs it below the untested ones; within the tested block cards sort by
  execution time (most recently run on top). Board, list view and keyboard
  navigation share one ordering (`lib/order.ts`, unit-tested).

## [0.15.2] - 2026-07-12

### Added
- The **cue brand** in the top-left header is clickable and reloads the page
  (hover tint + press feedback).

## [0.15.1] - 2026-07-12

### Added
- **Custom dialogs everywhere**: new reusable `InputDialog` (MD3, autofocus,
  Enter/Esc, inline validation) replaces the last native `window.prompt()`
  calls (create/rename snippet group — now with a live duplicate check);
  deleting snippets (single from the editor, bulk from the selection bar)
  asks via the app's own `Confirm` dialog including a merge-semantics
  reminder. Project convention: no native browser dialogs.
- **Snippet management polish**: search field (abbreviation/title/body,
  umlaut-safe, hides empty groups while searching), visible **select mode**
  with checkboxes and a per-group select-all toggle (Cmd/Ctrl+click still
  works), drag **handles** on rows and group headers (no more click-vs-drag
  ambiguity; dragging pauses during search/selection), and a **copy button**
  per row that puts the snippet body on the clipboard.

## [0.15.0] - 2026-07-12

### Added
- **Snippet library** — an editing workbench for Inspector-Rust (IR) AI-prompt
  snippets with a lossless roundtrip: import an IR backup JSON, structure and
  edit the snippets in cue (groups collapsible + drag-sortable, snippets
  draggable across groups, multi-select bulk move/delete, editor with
  monospace abbreviation field + live duplicate check and Markdown preview),
  export back as an IR backup that "Settings → Backup & restore → Import"
  reads. New **Snippets** tab.
  - Format contract in `app/ir_format.py` (pure, tested incl. a golden
    roundtrip against a real IR fixture): version 2 envelope, unix-millis
    timestamps, `abbreviation` as merge key (verbatim, trim only), groups by
    NAME with empty groups + order in `snippet_categories`, three-valued
    `category` (`"name"` assign / `""` explicitly ungroup / `null` leave IR's
    assignment untouched) — cue exports `""` for ungrouped, never `null`.
  - Read-side tolerance: full envelope, snippets-only backups, the legacy
    `[{abbreviation,title?,body}]` format (lands ungrouped); encrypted
    backups are rejected with a clear message. Per-row errors are collected,
    never fatal. Import merges (upsert per abbreviation); `category: null`
    does not clobber a cue-side group move.
  - New tables `snippet` + `snippet_group` (per-tenant, abbreviation unique
    per user), full CRUD/reorder/bulk API under `/api/snippets`, partial
    export via `?groups=a,b`.
  - The UI carries a permanent hint that IR imports MERGE: deletions and
    abbreviation renames in cue do not delete/rename in IR.

## [0.14.3] - 2026-07-12

### Changed
- **Remaining test gaps closed** (backend 90 → 117 tests, coverage 96 % → 99 %;
  runner 56 → 65 tests, 81 % → 91 %): capture edge/error paths (blank prompts,
  empty bearer token, non-deliverable sessions, terminal context cleared after
  enqueue, settings for a deleted user), run lifecycle edges (blocked prompts
  stay queued on run create, cancel keeps manually-moved prompts, heartbeat on
  terminal runs), server-side prompt filters, expired-attachment tolerance
  (serve 404, GC + duplicate skip missing files), forged-session/uid guards,
  SPA fallbacks without index/static dir, idempotent DB migration, the OAuth
  urllib helpers — and the runner's orchestration loops (delivery/capture
  loops survive poll errors and always resolve claims, run_forever executes
  claims concurrently under MAX_CONCURRENCY and shuts down cleanly on SIGTERM,
  runner errors report the run as failed) plus every tmux/osascript delivery
  failure stage.

## [0.14.2] - 2026-07-12

### Added
- **Badge automation**: `scripts/update-badges.mjs` keeps the README's LOC and
  test-count badges current — LOC counted over source only (tests, generated
  files and dependencies excluded), test counts parsed from the real runners
  (`pytest --collect-only`, `vitest list`). Wired as `npm run update-badges`
  plus a `posttest` hook in a new root `package.json` (`npm test` runs all
  three suites).
- **Frontend unit tests** (Vitest, new): 53 tests over `src/lib` — escape-first
  markdown rendering (XSS), tag normalization/dedup, tonal color generation,
  API client CSRF handling, clipboard/speech wrappers, motion presets.

### Changed
- **Test suite maxed out**: backend 34 → 90 tests (coverage 84 % → 96 %; OAuth
  callback flows, session/CSRF/state primitives, project CRUD + tenant
  isolation, SPA path-traversal guard, security headers, attachment guards,
  merge/import/export edge cases, run-log pagination), cue-runner 22 → 56
  tests (coverage 59 % → 81 %; API client via httpx MockTransport, config
  parsing, stream >64-KiB events, delivery edge cases). No behavior changes.
- Shared backend test fixtures extracted into `backend/tests/conftest.py`.

## [0.14.1] - 2026-07-12

### Changed
- **Playbook step order follows the board**: the run dialog now initializes
  its steps in the Queued column's order (top to bottom, `sort_order`), no
  matter in which order the prompts were selected. ↑/↓ still allow manual
  overrides before starting.

## [0.14.0] - 2026-07-12

### Added
- **Board mirrors run execution**: creating a run moves all its source
  prompts into the Running column (stamps `ran_at` on first entry; blocked
  prompts are skipped). Finished steps already moved prompts — success →
  top of Done, failure → Failed — so the full lifecycle is now visible on
  the board. When a run ends without executing all steps (cancel while
  queued, stop-on-error failure, runner timeout via the reaper), the
  prompts of never-executed steps return to the queue instead of being
  stranded in Running.

## [0.13.0] - 2026-07-12

### Added
- **Run step progress**: the run list API (`GET /runs`) now carries
  `steps_done`/`steps_total` per run (steps in a terminal state vs. all
  steps). The run ticker overlay shows it for playbooks ("Playbook läuft… ·
  4/5 abgeschlossen", aggregated across runs when several are active), and
  the Runs tab shows a "4/5" chip in each playbook's header row.

### Changed
- **Active runs expanded by default**: on the Runs tab, queued/claiming/
  running runs open their detail (steps, live log, cancel) automatically;
  clicking the header still toggles, and a manual toggle wins over the
  default. Several runs can now be open at the same time (each open card
  fetches and polls its own detail).

## [0.12.1] - 2026-07-12

### Fixed
- **Cmd/Ctrl+Enter save in the composer**: the shortcut silently did nothing
  when any earlier keydown listener (e.g. a browser extension) called
  `preventDefault()` on the combo — the handler yielded to `defaultPrevented`.
  Capture and backup handler now coordinate through a WeakSet of handled
  events instead, so the save always fires exactly once. Additionally:
  `Cmd/Ctrl+S` saves too (fallback when something outside the page swallows
  Cmd+Enter), an empty prompt body shows an error toast instead of silently
  ignoring the shortcut, and an in-flight guard prevents duplicate prompts
  from rapid repeated presses.

### Changed
- **Blocked only for queued prompts**: the blocked toggle is now rendered only
  on queued prompts (cards, list rows, detail — analogous to the tested
  toggle on running/done). The server rejects `blocked=true` on non-queued
  prompts (400) and clears the flag whenever a prompt leaves the queue (PATCH
  and reorder); a one-time idempotent migration clears stale flags on
  existing data.

## [0.12.0] - 2026-07-12

### Added
- **Blocked status**: new toggle (left of the bookmark icon on cards, list
  rows and the detail). Blocked prompts are grayed out, sink to the bottom of
  their column, cannot be dragged and refuse running/done (client- and
  server-side 400) until unblocked; "Ausführen" is hidden for them.
- **Runs move prompts to Done**: a successfully finished run step moves its
  source prompt to Done (top of the column); a failed step moves it to Failed.
- **Run status overlay**: a floating pill (bottom left) shows active runs
  everywhere in the app — click opens the Runs tab; when a run finishes the
  board refreshes automatically and a toast reports the outcome.
- **Active project in the header**: the board view labels the selected
  project (or "Alle Projekte" / "Ohne Projekt") next to the cue brand, with a
  spring entrance on every change.
- **Column cap**: board columns show at most 10 cards; more are collapsed
  behind a per-column "+N weitere anzeigen" expander (the first 10 stay
  visible).
- Parallel runs: the Mac runner already supported it — `MAX_CONCURRENCY` in
  `cue-runner/.env` is now set to 3, so up to three runs (each its own Claude
  session) execute simultaneously.

### Changed
- **Done goes on top**: moving a prompt to Done (status chips, keyboard `3`,
  drag into the column, or a finished run) now always places it at the TOP of
  the Done column.

### Fixed
- Cmd/Ctrl+Enter in the composer is now double-hardened: the window listener
  runs in the capture phase (nothing can swallow the event first) and the
  sheet keeps a bubble-phase backup handler (guarded against double-saving).

## [0.11.1] - 2026-07-12

### Changed
- Multi-select on cards/rows now uses **Cmd/Ctrl+click** instead of
  Shift+click (Shift+click behaves like a plain click again). Note: on macOS
  Ctrl+click is the system right-click — use Cmd there.

## [0.11.0] - 2026-07-12

### Added
- **Shift+click multi-select** on board cards and list rows: the first
  shift+click selects a prompt and brings up the action bar (Löschen /
  Ausführen / Zusammenführen), further shift+clicks toggle prompts in and out
  of the selection; deselecting the last one dismisses the bar. The explicit
  "Auswählen" mode keeps working as before.

### Fixed
- The selection action bar now disappears immediately when selection ends —
  its AnimatePresence exit never visibly played (the bar froze ~2 s at full
  opacity, then popped away). Spring entrance stays; removal is instant.

## [0.10.0] - 2026-07-12

### Added
- **Run dialog remembers its settings**: project base, model, permission mode,
  allowed tools, and the switches (stop on error, bare, skip permissions) are
  restored from the last run when the dialog opens (`localStorage`
  `cue-run-prefs`, validated against the server whitelists). Only the
  **subfolder** intentionally starts empty each time.

## [0.9.0] - 2026-07-12

### Added
- **Voice dictation in the Composer**: a mic chip next to the prompt field
  records speech via the browser-native Web Speech API and appends finalized
  phrases to the prompt body (live interim readout below the textarea, red
  pulsing indicator while recording). Auto-restarts across Chrome's silence
  timeout; stops on preview switch, save, and close. Browsers without the API
  (Firefox) don't show the button. `Permissions-Policy` now allows
  `microphone=(self)`.

## [0.8.0] - 2026-07-12

### Added
- **Animated theme switch** (like celox.io): toggling light/dark reveals the
  new theme as an expanding circle from the click point via the View
  Transitions API (900 ms desktop, 520 ms on small/touch screens, emphasized
  ease-out). Works from the topbar toggle and the theme chips in Settings;
  keyboard activation reveals from the button's center. Falls back to an
  instant switch without API support or under `prefers-reduced-motion`.

## [0.7.1] - 2026-07-12

### Changed
- **Verlauf: newest prompts first.** The prompt timeline inside an expanded
  session now lists captured prompts newest-first (`GET /sessions/{id}` orders
  by `seq` descending) — previously new entries were appended at the bottom.

## [0.7.0] - 2026-07-12

### Added
- **Double-click to edit**: double-clicking the content in the prompt detail
  (rendered preview or raw text) opens the edit dialog; double-clicking the
  Markdown preview inside the composer switches back to the editor with the
  textarea focused.

### Fixed
- **Cmd/Ctrl+Enter saves the composer again regardless of focus.** Clicking a
  non-focusable area (e.g. the rendered preview) moved keyboard focus to
  `<body>`, where the save shortcut — previously bound to the sheet element —
  never fired. It now lives on a window-level listener while the dialog is open.

## [0.6.0] - 2026-07-10

### Added
- **Project badge menu in the prompt detail**: clicking the project badge opens
  a popover to **move** the prompt to another project (or "Kein Projekt") or to
  **copy** it into another project. Prompts without a project show a subtle
  "Kein Projekt" badge so the menu stays reachable. Escape / outside click
  closes just the menu (the sheet stays open).
- New endpoint `POST /prompts/{id}/duplicate {project_id}`: clones title, body
  and tags — **screenshots are duplicated on disk** so the copy owns its files
  independently — and the copy always lands as **Queued** in the target project.

## [0.5.1] - 2026-07-09

### Fixed
- Capture project fallback (no git repo at/above the cwd) now also skips
  `_`-prefixed grouping folders — a session started directly in
  `_customers/celox` lands in project "celox", not "_customers". Existing
  `_customers` sessions were migrated to their per-customer projects.

## [0.5.0] - 2026-07-09

### Added
- **Projekt-Chips im Board sortierbar**: the project filter chips above the
  board/list can now be drag-reordered in place (same order source as the
  Projekte view — `Project.sort_order`); "Alle" / "Ohne Projekt" stay fixed.
- **Precise capture project derivation via git root**: the capture hook now
  reports the cwd's git repo root, and cue derives the project name from it
  relative to the base with `_`-prefixed grouping folders skipped — so repos
  under `_customers/` become separate projects (`celox/website`,
  `boarding-m/website`, `hus-ic`, …) instead of all lumping into one
  `_customers` project. Fully backward-compatible: items without `git_root`
  (old hook, no repo) keep the first-segment fallback, existing projects and
  sessions are untouched.

## [0.4.2] - 2026-07-02

### Fixed
- Deleting a capture session that had a "send to CLI" delivery no longer
  crashes with a FK 500 — `CliDelivery` rows are removed first, and the child
  deletes are flushed before the parent (also fixes the same latent ordering
  issue for sessions with captured prompts).
- The runner strips ESC/control bytes from delivered text, so a prompt can't
  smuggle a bracketed-paste terminator (`ESC[201~`) that would end paste mode
  early and run the remainder as live keystrokes/commands.
- The runner now reports a `failed` result if a delivery transport raises
  (missing `osascript`/`tmux`, oversized argv, …) instead of silently orphaning
  the claimed delivery; and each `osascript`/`tmux` call has a 20 s timeout so a
  hung terminal (or the first-run Automation-permission dialog) can't wedge the
  whole delivery loop.
- The terminal context is now fully refreshed on every captured prompt (stale
  iTerm GUID / recyclable tmux pane is cleared when a session resumes elsewhere),
  so a delivery can't be routed into an unrelated terminal.
- A delivery stuck in `sending` (runner died mid-flight) is reaped to `failed`
  on the next claim instead of lingering forever.
- `SendToSessionDialog`: closing the dialog while a send/poll is in flight no
  longer updates state after unmount or fires a stray toast seconds later.

## [0.4.1] - 2026-07-02

### Fixed
- Tags are now deduplicated case-insensitively per prompt — the tag input
  refuses to add a tag the prompt already has, and tags are deduped on save and
  on render, so a tag (e.g. `optimization`) can never appear twice on a prompt.
- Editing a prompt: clicking outside the dialog no longer closes it (avoids
  losing edits by an accidental click on the backdrop). Close via the ✕,
  "Abbrechen", or Esc. Creating a new prompt still closes on outside click.

## [0.4.0] - 2026-07-02

### Added
- **Send a prompt into a live CLI session** — the reverse of prompt capture.
  From a prompt's detail view (owner-only), pick a running Claude-Code session
  and cue types the prompt into that terminal, either just inserting it or
  submitting it (Enter). Implemented over the existing runner:
  - The capture hook now records the session's terminal context
    (`ITERM_SESSION_ID` / `TMUX`), so cue knows which terminal each Claude
    session lives in; `CaptureSession` gains `deliverable` when it's reachable.
  - New `CliDelivery` queue: `POST /api/sessions/{id}/send` (owner) enqueues,
    the runner claims via `GET /api/cli/claim` and reports via
    `POST /api/cli/{id}/result`.
  - Runner transport layer (`cue_runner/deliver.py`): **iTerm2** (AppleScript
    `write text`) and **tmux** (`paste-buffer`), both using **bracketed paste**
    so multi-line prompts land as literal input; ids validated, argv-only (no
    shell/AppleScript injection).
  - `SendToSessionDialog`: picks the most relevant live session (prompt's
    project first), "und ausführen" toggle (default off), polls for the result.

### Note
- iTerm2 automation needs a one-time **Automation permission** (System Settings
  → Privacy & Security → Automation) for the process running the runner.

## [0.3.2] - 2026-07-02

### Fixed
- Deleting (or merging away) a prompt that had been executed in a run no longer
  crashes with a 500 — the `RunStep.prompt_id` foreign key is detached first
  (the step keeps its text snapshot).
- Deleting a project that has capture sessions no longer crashes with a 500 —
  `CaptureSession.project_id` is unassigned alongside the project's prompts.
- Composer: removing an already-saved screenshot and then pressing **Abbrechen**
  no longer deletes it permanently; existing attachments are only deleted on a
  successful save, uncommitted uploads still get cleaned up on cancel.

### Security (cue-runner hardening — defense-in-depth vs. a compromised server)
- `allowed_tools` tokens starting with `-` are rejected, so a malicious server
  can't smuggle extra `claude` CLI flags (e.g. `--dangerously-skip-permissions`).
- The `claude` subprocess no longer inherits the runner's `RUNNER_TOKEN` /
  `CAPTURE_TOKEN` (or `CUE_*` config) — a run step can't read them from its env.
- Steps run in their own process group (`start_new_session`); cancel/timeout now
  signals the whole tree, so tool-spawned grandchildren aren't orphaned.
- The project path is re-validated after `realpath`, closing a symlink escape of
  the base whitelist.
- The stream-json reader tolerates events larger than 64 KiB and surfaces reader
  errors as a failed step instead of a false success.

## [0.3.1] - 2026-07-02

### Changed
- **Verlauf** now shows **one collapsible card per project** (project summary:
  session + prompt counts, latest activity) with the individual capture sessions
  as expandable subgroups inside — instead of a flat list of session cards under
  a project heading.

## [0.3.0] - 2026-07-01

### Added
- **Prompt capture** — a Claude Code `UserPromptSubmit` hook logs every prompt
  you type in the CLI into cue via the cue-runner's forwarder (spool → batched,
  dedup-safe upload).
  - New **Verlauf** view: capture sessions grouped by project → prompt timeline,
    with copy and **promote-to-queue**; session delete.
  - The project is derived from the working directory under a configurable base.
  - **Multi-tenant**: per-user capture token + project base (Settings →
    Prompt-Capture); the runner sets `CUE_NO_CAPTURE=1` on its own runs.
- Drag-to-reorder projects (order drives the filter chips).

## [0.2.0] - 2026-06-29

### Added
- **Run engine** — execute saved prompts through the Claude Code CLI via a
  Mac-side runner (`cue-runner/`) that polls cue, atomically claims runs, runs
  them headless (`claude -p --output-format stream-json`), and reports results.
  - **single** (one prompt) and **chain**/playbook (ordered prompts in one Claude
    session via `--session-id`/`--resume`) runs.
  - Owner-only **Runs** tab with status badges, live log tail, copyable session
    id, cost, step breakdown, **cancel** and **re-run**.
  - `RunDialog` with whitelisted project path, model, permission-mode, allowed
    tools, bare mode, skip-permissions (warned), stop-on-error.
  - Project-path whitelist (server + runner), `RUNNER_TOKEN` auth, atomic claim,
    heartbeat, and a stale-run reaper.

## [0.1.0] - 2026-06-28

First public release.

### Added
- Multi-tenant prompt queue with **Google OAuth** login and per-user data
  isolation (email/domain allowlist).
- **Kanban board** with drag-between-columns status changes + reorder, and a
  status-grouped, collapsible **list view** with subtle status colors.
- **Composer** with Markdown editor, live preview, autosave draft, tag
  autocomplete (curated dev tags + previously used), and last-project preselect.
- **Bookmarks** section with drag-and-drop ordering.
- **"Tested"** toggle for running/done prompts.
- **Merge** several prompts into one (reorder, format, originals delete/archive/keep).
- **Delete with undo** (single + bulk via multi-select).
- **Screenshot attachments** via drag-and-drop, paste, or file picker — with a
  lightbox viewer and **automatic deletion after 30 days**.
- One-click copy to clipboard, import (`.txt`) / export (JSON, ZIP).
- Material Design 3 Expressive UI with spring motion, light/dark/system themes,
  dynamic color, full keyboard shortcuts, and PWA support.
- Mobile-optimized, no-horizontal-scroll responsive layout.

[0.7.0]: https://github.com/pepperonas/cue/releases/tag/v0.7.0
[0.6.0]: https://github.com/pepperonas/cue/releases/tag/v0.6.0
[0.5.1]: https://github.com/pepperonas/cue/releases/tag/v0.5.1
[0.5.0]: https://github.com/pepperonas/cue/releases/tag/v0.5.0
[0.4.2]: https://github.com/pepperonas/cue/releases/tag/v0.4.2
[0.4.1]: https://github.com/pepperonas/cue/releases/tag/v0.4.1
[0.4.0]: https://github.com/pepperonas/cue/releases/tag/v0.4.0
[0.3.2]: https://github.com/pepperonas/cue/releases/tag/v0.3.2
[0.3.1]: https://github.com/pepperonas/cue/releases/tag/v0.3.1
[0.3.0]: https://github.com/pepperonas/cue/releases/tag/v0.3.0
[0.2.0]: https://github.com/pepperonas/cue/releases/tag/v0.2.0
[0.1.0]: https://github.com/pepperonas/cue/releases/tag/v0.1.0
