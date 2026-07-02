# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.2]: https://github.com/pepperonas/cue/releases/tag/v0.3.2
[0.3.1]: https://github.com/pepperonas/cue/releases/tag/v0.3.1
[0.3.0]: https://github.com/pepperonas/cue/releases/tag/v0.3.0
[0.2.0]: https://github.com/pepperonas/cue/releases/tag/v0.2.0
[0.1.0]: https://github.com/pepperonas/cue/releases/tag/v0.1.0
