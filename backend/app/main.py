"""FastAPI application entrypoint.

One process serves the JSON API under /api and the built frontend (SPA) for
everything else. Security headers + a strict CSP are applied to every response.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import init_db
from .routers import auth, importexport, projects, prompts

_settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):  # noqa: ANN201
    init_db()
    yield


app = FastAPI(
    title="cue",
    version="1.0.0",
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
            "img-src 'self' data: blob:",
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
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


# ---- API ----
api = FastAPI(title="cue-api")
api.include_router(auth.router)
api.include_router(projects.router)
api.include_router(prompts.router)
api.include_router(importexport.router)


@api.get("/health")
def health() -> dict:
    return {"status": "ok"}


# 401/403 etc. from the sub-app should surface as clean JSON.
app.mount("/api", api)


# ---- Static frontend (SPA) ----
_static_dir = Path(_settings.static_dir)
_index = _static_dir / "index.html"

if _static_dir.is_dir():
    # Assets (hashed) get served directly; unknown paths fall back to index.html
    # so client-side routing works on hard reload.
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> Response:
        candidate = _static_dir / full_path
        if full_path and candidate.is_file():
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
