# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
