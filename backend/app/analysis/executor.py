"""Server-seitiger Ausführer der Projekt-Analyse.

Spiegelbild des Mac-Runners, genau wie `optimization/server_executor`: gleiche
Schleife aus claim → ausführen → melden, nur läuft der Aufruf hier im Container
gegen die Messages API und auf Rechnung dessen, der den Lauf angestoßen hat.

⚠️ Die Bausteine für „wie spricht cue mit der Messages API" (Client aus dem
entschlüsselten Nutzer-Schlüssel, Kosten aus der Usage, Text aus der
Content-Liste) werden aus `optimization/server_executor` IMPORTIERT statt
nachgebaut. Eine zweite Kostenrechnung daneben wäre eine zweite Wahrheit über
dasselbe Geld — und der Weg, auf dem die Preistabelle an einer Stelle gepflegt
und an der anderen vergessen wird.
"""
from __future__ import annotations

import asyncio
import logging
import time

import anthropic
from sqlmodel import Session

from ..config import get_settings
from ..db import engine
from ..optimization import pricing, providers
from ..optimization.server_executor import MissingKey, _client_for, _text_of, _usage_cost
from ..optimization.service import ExecutionResult
from .service import ProjectAnalysisService

log = logging.getLogger("cue.analysis.server")

RUNNER_ID = "server"
POLL_SECONDS = 2.0
#: Eine Analyse antwortet mit JSON über bis zu 20 Prompts — großzügig, aber
#: gedeckelt, weil ein Modell ohne Grenze gern weiterschreibt.
MAX_TOKENS = 16_000


def run_one(session: Session, *, client_factory=_client_for) -> bool:
    """Höchstens einen server-seitigen Analyse-Job ausführen. True, wenn einer lief."""
    service = ProjectAnalysisService(session)
    job = service.claim(RUNNER_ID, providers.server_ids())
    if job is None:
        return False

    settings = get_settings()
    started = time.monotonic()
    from ..models import ProjectAnalysis

    lauf = session.get(ProjectAnalysis, job.id)
    model = job.model or pricing.DEFAULT_MODEL
    try:
        client, _ = client_factory(session, lauf.user_id if lauf else None)
    except MissingKey as exc:
        service.complete(job.id, ExecutionResult(status="failed", error=str(exc), duration_ms=0))
        return True

    try:
        message = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": job.prompt}],
            timeout=float(settings.optimize_timeout),
        )
        text = _text_of(message)
        kosten, ein, aus = _usage_cost(model, getattr(message, "usage", None))
        dauer = int((time.monotonic() - started) * 1000)
        service.complete(
            job.id,
            ExecutionResult(
                status="succeeded" if text else "failed",
                optimized_text=text or None,
                error=None if text else "Die API lieferte keinen Text zurück",
                model=getattr(message, "model", model) or model,
                duration_ms=dauer,
                cost_usd=kosten,
                input_tokens=ein,
                output_tokens=aus,
            ),
        )
    except anthropic.APIStatusError as exc:
        service.complete(
            job.id,
            ExecutionResult(
                status="failed",
                error=f"API-Fehler {exc.status_code}"[:800],
                duration_ms=int((time.monotonic() - started) * 1000),
            ),
        )
    except Exception as exc:  # noqa: BLE001 — ein Arbeiter stirbt nie an einem Job
        log.warning("server analysis failed id=%s: %s", job.id, exc)
        service.complete(
            job.id,
            ExecutionResult(
                status="failed",
                error=str(exc)[:800] or "Unbekannter Fehler",
                duration_ms=int((time.monotonic() - started) * 1000),
            ),
        )
    return True


def _drain_once() -> bool:
    with Session(engine) as session:
        return run_one(session)


async def loop(stop: asyncio.Event | None = None) -> None:
    while stop is None or not stop.is_set():
        try:
            gearbeitet = await asyncio.to_thread(_drain_once)
        except Exception:  # noqa: BLE001
            log.exception("server analysis loop")
            gearbeitet = False
        if gearbeitet:
            continue
        try:
            if stop is None:
                await asyncio.sleep(POLL_SECONDS)
            else:
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
