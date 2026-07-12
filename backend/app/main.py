"""FastAPI application entrypoint.

One process serves the JSON API under /api and the built frontend (SPA) for
everything else. Security headers + a strict CSP are applied to every response.
"""
from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .config import get_settings
from .db import engine, init_db
from .routers import attachments, auth, capture, importexport, projects, prompts, runs, snippets

_settings = get_settings()


async def _attachment_gc_loop() -> None:
    """Periodically delete attachments past their TTL (auto-cleanup of screenshots)."""
    while True:
        try:
            with Session(engine) as session:
                attachments.purge_expired(session)
        except Exception:
            pass
        await asyncio.sleep(24 * 3600)


async def _run_reaper_loop() -> None:
    """Fail runs whose runner stopped heart-beating (also cleans up runs left
    in-flight across a backend restart). Runs immediately, then every 60 s."""
    while True:
        try:
            with Session(engine) as session:
                runs.reap_stale(session, _settings.run_stale_timeout)
        except Exception:
            pass
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
    version="0.15.0",
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


@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN001, ANN201
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = _csp()
    # microphone=(self): voice dictation in the Composer (Web Speech API).
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=()"
    return response


# ---- API ----
api = FastAPI(title="cue-api")
api.include_router(auth.router)
api.include_router(projects.router)
api.include_router(prompts.router)
api.include_router(attachments.router)
api.include_router(runs.router)
api.include_router(capture.router)
api.include_router(snippets.router)
api.include_router(importexport.router)


@api.get("/health")
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

    @app.get("/{full_path:path}")
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

    @app.get("/")
    def no_frontend() -> JSONResponse:
        return JSONResponse(
            {"detail": "Frontend not built. Run the dev server or build into STATIC_DIR."},
            status_code=200,
        )
