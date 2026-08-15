#!/bin/sh
# Deploy cue: build, swap the container, and don't hand it back until it serves.
#
# Run ON THE VPS, from /opt/cue, after the rsync.
#
# What this exists for: `docker compose up -d --build` returns as soon as the
# container has STARTED, which is several seconds before uvicorn has run the
# migrations and bound the port. In that window nginx has nowhere to proxy to,
# so every request gets a 502 — the access log shows one burst per deploy, and
# twelve of them were plain `GET /`, i.e. someone loading the app and getting a
# broken page.
#
# Two things narrow that window to about nothing:
#
#   1. `--wait` blocks until the container reports HEALTHY (the Dockerfile's
#      HEALTHCHECK polls /api/health), so the deploy is only "done" once the
#      app actually answers.
#   2. nginx retries the next upstream attempt instead of passing the 502 on
#      (see the `proxy_next_upstream` block in deploy/nginx.conf).
#
# The build runs BEFORE the old container is touched, so a broken build leaves
# production exactly as it was — that is already how it behaves today, and it
# is worth keeping: verify, then swap.
set -eu

cd "${CUE_DIR:-/opt/cue}"

echo "==> Bauen (die laufende Instanz bleibt unberührt)"
docker compose build

echo "==> Umschalten und auf Gesundheit warten"
# --wait needs a healthcheck; ours lives in the Dockerfile. --wait-timeout keeps
# a hanging start from blocking the deploy forever.
docker compose up -d --wait --wait-timeout 90

echo "==> Nachprüfen"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 http://127.0.0.1:8791/api/health >/dev/null 2>&1; then
    echo "cue antwortet (Versuch $attempt)"
    exit 0
  fi
  sleep 1
done

echo "cue antwortet nach dem Deploy nicht — Logs:" >&2
docker compose logs --tail 40 cue >&2
exit 1
