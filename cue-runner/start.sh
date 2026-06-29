#!/usr/bin/env bash
# PM2 launcher for cue-runner (uses the project venv directly; loads ./.env).
cd "$(dirname "$0")"
exec ./.venv/bin/python -m cue_runner
