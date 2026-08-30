# cue-runner

Mac-side daemon that executes saved **cue** prompts through the **Claude Code CLI**.

cue runs on a VPS and cannot call the local `claude` CLI directly. This runner
polls the cue backend, atomically claims queued runs, executes them headless
(`claude -p … --output-format stream-json --verbose`), streams the events back
as a live log, and reports step/run results. Pure outbound HTTP — no open ports.

- **single** run = one prompt → one `claude` invocation.
- **chain** run = ordered prompts in one Claude session (step 0 pre-assigns a
  `--session-id`, steps 1..n use `--resume`). All steps run with the same `cwd`
  (= `project_path`), enforced by the project-path whitelist.

> Verified against Claude Code CLI **v2.1.195**: there is no `--cwd` (the runner
> sets the subprocess working directory) and no `--max-turns` (cost/loop control
> via per-step `RUN_TIMEOUT` + `--permission-mode`).

## Setup

```bash
cd cue-runner
uv venv && uv pip install -e ".[dev]"
cp .env.example .env        # set RUNNER_TOKEN (must match the cue backend) + ALLOWED_BASES
uv run pytest               # run tests (56 — executor, stream parser, delivery, API client; all offline)
uv run python -m cue_runner # start the daemon
```

`RUNNER_TOKEN` must equal the backend's `RUNNER_TOKEN`. `ALLOWED_BASES` lists the
absolute base paths a run's `project_path` may sit under (re-validated here even
though the backend also checks). The `claude` CLI must be logged in on this Mac.

## Run under PM2

`start.sh` cds into this directory and runs the venv Python directly (no `uv` on
PATH needed, loads `./.env`):

```bash
pm2 start ./start.sh --name cue-runner --interpreter bash
pm2 save
pm2 logs cue-runner
```

A clean start logs `cue-runner started → <CUE_API_URL>` followed by
`POST /api/runs/claim "204 No Content"` while idle.

## Configuration (`.env`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `CUE_API_URL` | yes | — | cue backend base URL (https) |
| `RUNNER_TOKEN` | yes | — | shared secret (`Authorization: Bearer`) |
| `ALLOWED_BASES` | yes | — | comma-separated allowed project base paths |
| `CLAUDE_PATH` | no | `claude` | path to the CLI |
| `RUNNER_ID` | no | `mac-runner` | id reported on claim |
| `POLL_INTERVAL` | no | `5` | floor on the idle claim cycle (see long polling) |
| `LONG_POLL_WAIT` | no | `25` | seconds the server may hold an empty claim open; `0` = plain polling |
| `MAX_CONCURRENCY` | no | `1` | concurrent runs (semaphore) |
| `HEARTBEAT_INTERVAL` | no | `15` | seconds between heartbeats (also picks up cancels) |
| `RUN_TIMEOUT` | no | `1800` | hard per-step timeout (seconds) |
| `CAPTURE_TOKEN` | no | — | enables the capture forwarder (spool → `/api/capture`) |
| `CUE_DELIVER` | no | `1` | `0` disables the "send prompt into a live session" loop |
| `DELIVER_INTERVAL` | no | `1.5` | seconds between delivery-claim polls |
| `CUE_OPTIMIZE` | no | `1` | `0` disables the prompt-optimization loop |
| `OPTIMIZE_INTERVAL` | no | `3` | floor on the optimization claim cycle |
| `OPTIMIZE_TIMEOUT` | no | `180` | hard timeout for one optimization (seconds) |
| `OPTIMIZE_MAX_CHARS` | no | `32000` | refuse anything longer before spending a call |
| `CUE_CAPTURE_SPOOL` | no | `~/.cue-runner/capture-spool.jsonl` | where the hook writes captured prompts |
| `CUE_CAPTURE_STATE` | no | `~/.cue-runner/capture-state.json` | forwarder position in that spool |
| `CAPTURE_INTERVAL` | no | `2` | seconds between forwarder passes |

## Long polling

The runner has three claim loops (runs, CLI deliveries, optimizations) that are
idle almost all the time. Asking every 1.5–5 s produced ~4.300 requests an hour
— on a live install that was **97 % of all traffic to cue**, every one of them
answered "nothing to do".

Each claim now sends `?wait=N`: the request stays open and the *server*
re-checks once a second until work turns up or the budget runs out. One request
covers the whole window, and pickup gets **faster** than the old 1.5–5 s poll.
`POLL_INTERVAL`/`DELIVER_INTERVAL`/`OPTIMIZE_INTERVAL` become a floor on the
cycle time rather than a fixed sleep, so if the server answers immediately —
long polling off, or an older backend that ignores `wait` — the loops fall back
to exactly the old behaviour. That is what makes the runner safe to start
against either version.

## Prompt optimization — only for jobs that belong here

The runner also claims **prompt optimizations** and runs them through
`claude -p … --output-format json`. Since cue 0.54.0 that is no longer the only
way: a user who stores their own Anthropic API key has their jobs executed
**server-side** against the Messages API, billed to them.

The two paths must not cross, so the server's claim query filters on
provider (`providers.runner_ids()`): a job queued against somebody's API key is
invisible to this runner. Nothing has to be configured for that — but it is the
reason a queued optimization may never show up here, and that is correct rather
than broken.

`CUE_OPTIMIZE=0` turns the loop off; the runner keeps doing runs, deliveries and
capture.

⚠️ Errors come out of **stdout**, not stderr: the CLI puts API failures (weekly
quota, auth, 429) into the JSON envelope and often leaves stderr empty even on
exit 1. Quota and auth failures are not retried — producing the same message
again only costs time.

## Sending prompts into a live session (iTerm2 / tmux)

The runner can type a prompt from the web app into a **running** Claude-Code
session (owner-only). The capture hook records each session's terminal context
(`ITERM_SESSION_ID`, `TMUX`), the runner polls `GET /api/cli/claim`, and delivers
via **iTerm2** (`osascript`/AppleScript) or **tmux** (`paste-buffer`) using
bracketed paste (multi-line safe), optionally pressing Enter to submit.

> **macOS Automation permission (one-time):** iTerm2 delivery uses AppleScript,
> so the process running the runner (e.g. iTerm/PM2) needs **System Settings →
> Privacy & Security → Automation → allow controlling *iTerm***. The first
> delivery triggers the prompt; until granted, deliveries report `failed`.

---

© 2026 Martin Pfeffer | celox.io
