# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /fe
# Pin pnpm to match the lockfile; bare `corepack enable` would pull pnpm 11.x,
# which requires Node 22+ and crashes on this Node 20 base.
RUN corepack enable && corepack prepare pnpm@10.2.1 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
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
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
