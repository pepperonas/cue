"""FastAPI application entrypoint.

One process serves the JSON API under /api and the built frontend (SPA) for
everything else. Security headers + a strict CSP are applied to every response.
"""
from __future__ import annotations

import asyncio
import contextlib
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

import logging

from . import events
from .config import get_settings
from .optimization import PromptOptimizationService
from .db import engine, init_db
from .routers import (
    admin,
    attachments,
    auth,
    capture,
    changes,
    importexport,
    optimize,
    projects,
    prompts,
    runs,
    snippets,
    stats,
    sync,
    tags,
)

_settings = get_settings()
log = logging.getLogger("cue.housekeeping")


def _log_housekeeping_failure(what: str, state: dict) -> None:
    """Report a failing background loop — at most once a minute per loop.

    These loops swallowed every exception with a bare `pass`, which keeps them
    alive (right) and keeps them silent (wrong). A broken attachment GC means
    screenshots are never deleted, which the composer explicitly PROMISES the
    user; a broken reaper leaves prompts stuck in Running forever. Neither was
    observable from anywhere — no log line, no metric, nothing to notice.

    Rate-limited because a loop that fails once usually fails every tick, and a
    reaper running every 60 s would otherwise fill the journal with the same
    traceback.
    """
    now = time.monotonic()
    if now - state["last"] < 60:
        state["suppressed"] += 1
        return
    log.exception(
        "%s failed%s — the loop keeps running",
        what,
        f" ({state['suppressed']} further failures suppressed)" if state["suppressed"] else "",
    )
    state["last"] = now
    state["suppressed"] = 0


async def _attachment_gc_loop() -> None:
    """Periodically delete attachments past their TTL (auto-cleanup of screenshots)."""
    state = {"last": 0.0, "suppressed": 0}
    while True:
        try:
            with Session(engine) as session:
                attachments.purge_expired(session)
                # Same cadence for the activity log's retention window.
                events.prune(session)
        except Exception:  # noqa: BLE001 — the loop must outlive one bad tick
            _log_housekeeping_failure("attachment/event cleanup", state)
        await asyncio.sleep(24 * 3600)


async def _run_reaper_loop() -> None:
    """Fail runs whose runner stopped heart-beating (also cleans up runs left
    in-flight across a backend restart). Runs immediately, then every 60 s.
    The same tick reaps optimization jobs whose executor never reported back."""
    state = {"last": 0.0, "suppressed": 0}
    while True:
        try:
            with Session(engine) as session:
                runs.reap_stale(session, _settings.run_stale_timeout)
                PromptOptimizationService(session, _settings).reap_stale()
        except Exception:  # noqa: BLE001 — the loop must outlive one bad tick
            _log_housekeeping_failure("run/optimization reaper", state)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app: FastAPI):  # noqa: ANN201
    init_db()
    tasks = [
        asyncio.create_task(_attachment_gc_loop()),
        asyncio.create_task(_run_reaper_loop()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title="cue",
    version="0.45.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


# ---- Security headers + CSP on every response ----
def _csp() -> str:
    # Google Fonts (stylesheet + font files) are allowed; everything else self.
    return "; ".join(
        [
            "default-src 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "img-src 'self' data: blob: https://*.googleusercontent.com",
            # Inline style needed for the Material You dynamic-color CSS variables
            # injected at runtime + Google Fonts stylesheet.
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "script-src 'self'",
            f"connect-src 'self' {_settings.allowed_origin}".strip(),
            "manifest-src 'self'",
            "worker-src 'self'",
            "object-src 'none'",
        ]
    )


def cache_control_for(path: str) -> str | None:
    """Caching policy for the static frontend, or None to leave a response alone.

    Two classes, and the split is what keeps a deploy from breaking open
    browsers. Vite content-hashes everything it emits into /assets, so those
    files never change under their name and may be kept forever. EVERYTHING
    else — the HTML shell above all, plus the service worker, the PWA manifest
    and the pre-paint boot script — must be revalidated, because a deploy
    replaces the shell and deletes the hashed chunks the previous one pointed
    at.

    Without this the responses carried no `Cache-Control` at all, so browsers
    fell back to HEURISTIC freshness (a fraction of the age since
    `Last-Modified`) and served a shell that referenced chunks the deploy had
    already removed: 404s on `index-*.js` / `StatsView-*.js`, and a stylesheet
    refused because the 404 body came back as JSON. An ETag alone does not help
    — a fresh-by-heuristic response is not revalidated at all.

    API responses are deliberately untouched (they carry no freshness
    information, so they are revalidated anyway).
    """
    if path.startswith("/api"):
        return None
    if path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"
    return "no-cache"


@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN001, ANN201
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = _csp()
    # microphone=(self): voice dictation in the Composer (Web Speech API).
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=()"
    policy = cache_control_for(request.url.path)
    if policy and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = policy
    return response


# ---- API ----
api = FastAPI(title="cue-api")
api.include_router(auth.router)
api.include_router(admin.router)
api.include_router(projects.router)
api.include_router(prompts.router)
api.include_router(attachments.router)
api.include_router(runs.router)
api.include_router(capture.router)
api.include_router(snippets.router)
api.include_router(sync.router)
api.include_router(importexport.router)
api.include_router(stats.router)
api.include_router(optimize.router)
api.include_router(tags.router)
api.include_router(changes.router)


# HEAD as well as GET: FastAPI's APIRoute — unlike Starlette's plain Route —
# does not imply HEAD for a GET, so `HEAD /api/health` answered 405 and an
# uptime monitor using HEAD reported the site as down while it was fine.
@api.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict:
    return {"status": "ok"}


# 401/403 etc. from the sub-app should surface as clean JSON.
app.mount("/api", api)


# ---- Static frontend (SPA) ----
_static_dir = Path(_settings.static_dir).resolve()
_index = _static_dir / "index.html"

if _static_dir.is_dir():
    # Assets (hashed) get served directly; unknown paths fall back to index.html
    # so client-side routing works on hard reload.
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

    # HEAD included for the same reason as /api/health above: link checkers,
    # curl -I and uptime probes ask for the shell with HEAD.
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    def spa(full_path: str) -> Response:
        # Guard against path traversal: the resolved candidate must stay inside
        # the static dir (e.g. "../../etc/passwd" resolves outside -> reject).
        if full_path:
            candidate = (_static_dir / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(_static_dir):
                return FileResponse(candidate)
        if _index.is_file():
            return FileResponse(_index)
        return JSONResponse({"detail": "Frontend not built"}, status_code=404)
else:

    @app.api_route("/", methods=["GET", "HEAD"])
    def no_frontend() -> JSONResponse:
        return JSONResponse(
            {"detail": "Frontend not built. Run the dev server or build into STATIC_DIR."},
            status_code=200,
        )
