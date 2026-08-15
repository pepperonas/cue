# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /fe
# Pin pnpm to match the lockfile; bare `corepack enable` would pull pnpm 11.x,
# which requires Node 22+ and crashes on this Node 20 base.
RUN corepack enable && corepack prepare pnpm@10.2.1 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
# The shared ordering contract lives OUTSIDE frontend/ on purpose — neither
# side of it owns the file (see contracts/column-order.json). `pnpm build`
# runs `tsc -b`, which type-checks the test that reads it, so the build needs
# it at the path the import resolves to: /fe/src/lib/../../../contracts.
COPY contracts/ /contracts/
RUN pnpm build

# ---- Stage 2: python runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static \
    DB_PATH=/data/cue.db \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

# Backend deps first (better layer caching).
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend source.
COPY backend/app ./app

# Built frontend from stage 1.
COPY --from=frontend /fe/dist ./static

# Runtime data dir (mounted as a volume in compose).
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# Healthcheck hits the API health endpoint.
# Tight interval so `docker compose up --wait` learns the new container is
# serving within a second or two instead of idling until the next probe.
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

# --timeout-graceful-shutdown: on SIGTERM uvicorn waits for in-flight requests
# to finish, and this app deliberately PARKS requests for up to 25 s (the
# change feed and the three runner claim loops, see app/longpoll.py). Without
# a cap the old container therefore lingers for the whole docker stop grace
# period on every deploy, and that lingering — not the new container starting
# — is what the 502 burst in the access log actually was. Two seconds is
# plenty for a real request; a parked poll has nothing to lose by being cut,
# the client reconnects.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "2"]
