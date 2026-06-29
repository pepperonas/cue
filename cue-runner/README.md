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
uv run pytest               # run tests
uv run python -m cue_runner # start the daemon
```

`RUNNER_TOKEN` must equal the backend's `RUNNER_TOKEN`. `ALLOWED_BASES` lists the
absolute base paths a run's `project_path` may sit under (re-validated here even
though the backend also checks). The `claude` CLI must be logged in on this Mac.

## Run under PM2

```bash
pm2 start "uv run python -m cue_runner" --name cue-runner --cwd /Users/martin/claude/cue/cue-runner
pm2 save
pm2 logs cue-runner
```

## Configuration (`.env`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `CUE_API_URL` | yes | — | cue backend base URL (https) |
| `RUNNER_TOKEN` | yes | — | shared secret (`Authorization: Bearer`) |
| `ALLOWED_BASES` | yes | — | comma-separated allowed project base paths |
| `CLAUDE_PATH` | no | `claude` | path to the CLI |
| `RUNNER_ID` | no | `mac-runner` | id reported on claim |
| `POLL_INTERVAL` | no | `5` | seconds between idle claim attempts |
| `MAX_CONCURRENCY` | no | `1` | concurrent runs (semaphore) |
| `HEARTBEAT_INTERVAL` | no | `15` | seconds between heartbeats (also picks up cancels) |
| `RUN_TIMEOUT` | no | `1800` | hard per-step timeout (seconds) |

---

© 2026 Martin Pfeffer | celox.io
