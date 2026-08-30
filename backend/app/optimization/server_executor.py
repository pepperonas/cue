"""In-process optimizer for users who brought their own Anthropic API key.

The mirror image of the Mac runner: same claim → execute → report cycle, same
`PromptOptimization` rows, same UI polling — only the execution happens here,
against the Messages API, paid for by the key of whoever queued the job.

Why in-process at all, when the CLI path deliberately is not: the CLI needs a
machine with an authenticated Claude installation, which the VPS has neither of.
An HTTP call needs a key and a socket. Nothing else about the design changes.

One job at a time, like the runner's own optimize loop. These calls cost the
user money, and a burst of parallel requests is the one failure mode where that
is discovered afterwards.
"""
from __future__ import annotations

import asyncio
import logging
import time

import anthropic
from sqlmodel import Session

from .. import secrets_store
from ..config import get_settings
from ..db import engine
from ..models import PromptOptimization, User
from . import pricing, providers
from .service import ExecutionResult, PromptOptimizationService

log = logging.getLogger("cue.optimize.server")

#: Marks jobs this worker claimed, in the same column the Mac runner writes.
RUNNER_ID = "server"

#: How often to look for work. Higher than the runner's poll because there is
#: no network round trip: this is a local query against an indexed column.
POLL_SECONDS = 2.0


class MissingKey(Exception):
    """The user's key vanished between queueing and execution."""


def _client_for(session: Session, user_id: int | None) -> tuple[anthropic.Anthropic, str]:
    user = session.get(User, user_id) if user_id else None
    key = secrets_store.decrypt(user.anthropic_key_enc) if user else None
    if not key:
        raise MissingKey("Kein API-Key hinterlegt")
    # Explicit key, never the ambient environment: the server's own credentials
    # (if it ever had any) must not silently pay for a user's optimization.
    return anthropic.Anthropic(api_key=key, max_retries=1), key


def _usage_cost(model: str, usage) -> tuple[float | None, int, int]:  # noqa: ANN001
    """Cost and the two token counts we store, from one response's usage.

    The Messages API reports no price, so this is where the money comes from —
    see `pricing.py` for why computing it here is right and computing it for
    the CLI path would be wrong.
    """
    read = lambda name: int(getattr(usage, name, 0) or 0)  # noqa: E731
    input_tokens = read("input_tokens")
    output_tokens = read("output_tokens")
    cost = pricing.cost_usd(
        model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_write_tokens=read("cache_creation_input_tokens"),
        cache_read_tokens=read("cache_read_input_tokens"),
    )
    return cost, input_tokens, output_tokens


def _text_of(message) -> str:  # noqa: ANN001
    """The answer, from a content list that is a discriminated union."""
    parts = [
        block.text
        for block in getattr(message, "content", [])
        if getattr(block, "type", "") == "text"
    ]
    return "\n".join(parts).strip()


def run_one(session: Session, *, client_factory=_client_for) -> bool:
    """Claim and execute at most one server-side job. True if one ran.

    Synchronous on purpose — it is called from a thread, and the SQLModel
    session it works with is not safe to share with an event loop.
    """
    service = PromptOptimizationService(session)
    job = service.claim(RUNNER_ID, providers.server_ids())
    if job is None:
        return False

    settings = get_settings()
    started = time.monotonic()
    row = session.get(PromptOptimization, job.id)
    model = job.model or pricing.DEFAULT_MODEL
    try:
        client, _ = client_factory(session, row.user_id if row else None)
    except MissingKey as exc:
        service.complete(
            job.id,
            ExecutionResult(status="failed", error=str(exc), exit_code=None, duration_ms=0),
        )
        return True

    try:
        message = client.messages.create(
            model=model,
            max_tokens=16000,
            messages=[{"role": "user", "content": job.prompt}],
            timeout=float(settings.optimize_timeout),
        )
        text = _text_of(message)
        cost, input_tokens, output_tokens = _usage_cost(model, getattr(message, "usage", None))
        elapsed = int((time.monotonic() - started) * 1000)
        if not text:
            service.complete(
                job.id,
                ExecutionResult(
                    status="failed",
                    error="Die API lieferte keinen Text zurück",
                    duration_ms=elapsed,
                    cost_usd=cost,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                ),
            )
            return True
        service.complete(
            job.id,
            ExecutionResult(
                status="succeeded",
                optimized_text=text[: settings.optimize_max_chars],
                model=getattr(message, "model", model) or model,
                duration_ms=elapsed,
                cost_usd=cost,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            ),
        )
    except anthropic.APIStatusError as exc:
        # The user's own key failing is the common case here (wrong key,
        # exhausted credit, rate limit) — their message, not a generic one.
        service.complete(
            job.id,
            ExecutionResult(
                status="failed",
                error=f"API-Fehler {exc.status_code}: {_api_message(exc)}"[:800],
                duration_ms=int((time.monotonic() - started) * 1000),
            ),
        )
    except Exception as exc:  # noqa: BLE001 - a worker must never die on one job
        log.warning("server optimization failed id=%s: %s", job.id, exc)
        service.complete(
            job.id,
            ExecutionResult(
                status="failed",
                error=str(exc)[:800] or "Unbekannter Fehler",
                duration_ms=int((time.monotonic() - started) * 1000),
            ),
        )
    return True


def _api_message(exc: anthropic.APIStatusError) -> str:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
    return str(exc)


async def loop(stop: asyncio.Event | None = None) -> None:
    """Background worker started from the app lifespan.

    Drains whatever is queued before sleeping, so a batch of ten does not take
    twenty seconds of polling to get going. Every DB session is opened and
    closed inside the thread that uses it.
    """
    while stop is None or not stop.is_set():
        try:
            worked = await asyncio.to_thread(_drain_once)
        except Exception:  # noqa: BLE001
            log.exception("server optimizer loop")
            worked = False
        if worked:
            continue
        try:
            if stop is None:
                await asyncio.sleep(POLL_SECONDS)
            else:
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass


def _drain_once() -> bool:
    with Session(engine) as session:
        return run_one(session)
