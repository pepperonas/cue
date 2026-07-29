"""Long polling for the runner's claim endpoints.

The runner has three independent claim loops (runs, CLI deliveries,
optimizations). Asking every 1.5–5 s meant ~4.300 requests an hour just to hear
"nothing to do". Long polling turns that around: the request stays open and the
SERVER re-checks, so the network sees one request per budget window while the
time to pick work up gets *shorter*, not longer.

Two deliberate choices:

* **A plain re-check loop, not an in-process notification.** Every enqueue path
  is a sync endpoint running in a worker thread, so waking a waiter would mean
  cross-thread signalling into the event loop — real complexity for well under a
  second of latency. A re-check is one indexed read against local SQLite.
* **A fresh session per attempt, opened inside the worker thread.** Nothing may
  stay checked out while we sleep. The pool holds five connections, so three
  runner loops each parking a `Depends(get_session)` connection for 25 s at a
  time would take most of it away from everything else — which is why these
  endpoints do not take the session dependency.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import TypeVar

from sqlmodel import Session
from starlette.concurrency import run_in_threadpool

# Looked up through the module on every use, never bound at import: the test
# fixture swaps in a tmp database by reloading `app.db`, and a module-level
# `from .db import engine` would keep pointing at the engine from import time.
from . import db

T = TypeVar("T")

# Ceiling for the client-requested budget. Must stay clearly below the reverse
# proxy's read timeout (nginx: 60 s), or the proxy drops the connection before
# we answer and the runner sees an error instead of an orderly "nothing to do".
MAX_WAIT_S = 25.0

# How often the server re-checks while holding a request open. This — not the
# client's poll interval — is what now bounds pickup latency.
TICK_S = 1.0


def budget_for(wait: float | None) -> float:
    """Clamp a client-requested wait into [0, MAX_WAIT_S]."""
    if not wait or wait <= 0:
        return 0.0
    return min(float(wait), MAX_WAIT_S)


def _once(attempt: Callable[[Session], T | None]) -> T | None:
    with Session(db.engine) as session:
        return attempt(session)


async def claim_with_wait(
    attempt: Callable[[Session], T | None], *, wait: float | None
) -> T | None:
    """Call `attempt` until it hands back work or the budget is spent.

    `attempt` receives its own session and must return a fully materialized
    result (the session is closed before this returns). Exceptions propagate on
    the spot — a claim that fails hard should reach the runner immediately
    rather than be retried silently for 25 s.

    With `wait` falsy this is exactly one attempt, i.e. the original behaviour.
    """
    result = await run_in_threadpool(_once, attempt)
    budget = budget_for(wait)
    if result is not None or budget <= 0:
        return result

    deadline = time.monotonic() + budget
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        await asyncio.sleep(min(TICK_S, remaining))
        result = await run_in_threadpool(_once, attempt)
        if result is not None:
            return result
