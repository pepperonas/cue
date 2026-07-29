"""Runner daemon: poll cue, claim runs, execute them, report results."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

from .api import RunnerApi
from .capture import CaptureForwarder
from .config import Config
from .deliver import deliver_one
from .executor import execute_run
from .optimize import run_next as optimize_next

log = logging.getLogger("cue-runner")


def cycle_delay(interval: float, elapsed: float) -> float:
    """How long to idle before the next poll of a claim loop.

    The interval is a FLOOR on the cycle time, not a fixed sleep. When the
    server long-polls, the request itself already spent the waiting time, so we
    go straight back in and one request covers the whole window. When it answers
    immediately — long polling off, or a backend that ignores `wait` — this is
    exactly the old fixed-interval behaviour, which is what makes the runner
    safe to start against either version.
    """
    return max(0.0, interval - elapsed)


async def until_stopped(coro, stop: asyncio.Event):
    """Await `coro`, giving up the moment `stop` is set.

    A long-polled claim parks for up to `LONG_POLL_WAIT` seconds. Without this
    the main loop would not see SIGTERM until the request came back, and the
    process manager (PM2 kills 1.6 s after SIGTERM) would hard-kill the runner
    mid-shutdown — skipping the graceful pass that cancels in-flight runs and
    lets them report. Returns None when `stop` won the race.

    Only the run loop needs it: the delivery/optimize/capture loops are
    cancelled outright once this one has exited.
    """
    task = asyncio.ensure_future(coro)
    stopper = asyncio.ensure_future(stop.wait())
    try:
        done, _ = await asyncio.wait({task, stopper}, return_when=asyncio.FIRST_COMPLETED)
        return task.result() if task in done else None
    finally:
        for pending in (task, stopper):
            if not pending.done():
                pending.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await pending


async def _idle(stop: asyncio.Event, interval: float, elapsed: float) -> None:
    delay = cycle_delay(interval, elapsed)
    if delay <= 0:
        return
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=delay)


async def _delivery_loop(cfg: Config, api: RunnerApi, stop: asyncio.Event) -> None:
    """Poll for prompts to type back into a live terminal session and perform them."""
    last_err_log = 0.0
    loop = asyncio.get_event_loop()
    while not stop.is_set():
        started = loop.time()
        worked = False
        try:
            d = await api.claim_delivery()
            if d:
                worked = True
                try:
                    status, error = await deliver_one(d)
                except Exception as exc:  # noqa: BLE001 — always resolve the claimed delivery
                    status, error = "failed", f"runner error: {exc}"[:400]
                await api.delivery_result(d["id"], status, error)
                if status == "sent":
                    log.info("delivered prompt to %s session", d.get("transport"))
                else:
                    log.warning("delivery %s failed: %s", d.get("id"), error)
        except Exception as exc:  # noqa: BLE001
            now = loop.time()
            if now - last_err_log > 60:
                log.warning("delivery poll paused (retrying): %s", exc)
                last_err_log = now
        if worked and not stop.is_set():
            continue  # drain the queue without waiting
        await _idle(stop, cfg.deliver_interval, loop.time() - started)


async def _optimize_loop(cfg: Config, api: RunnerApi, stop: asyncio.Event) -> None:
    """Work off prompt-optimization jobs — one at a time, never in parallel."""
    last_err_log = 0.0
    loop = asyncio.get_event_loop()
    while not stop.is_set():
        started = loop.time()
        worked = False
        try:
            worked = await optimize_next(cfg, api)
        except Exception as exc:  # noqa: BLE001
            now = loop.time()
            if now - last_err_log > 60:
                log.warning("optimization poll paused (retrying): %s", exc)
                last_err_log = now
        if worked and not stop.is_set():
            continue  # drain the queue back-to-back (batch mode)
        await _idle(stop, cfg.optimize_interval, loop.time() - started)


async def _capture_loop(cfg: Config, api: RunnerApi, stop: asyncio.Event) -> None:
    """Forward prompts written to the spool by the UserPromptSubmit hook."""
    fwd = CaptureForwarder(cfg, api)
    last_err_log = 0.0
    loop = asyncio.get_event_loop()
    while not stop.is_set():
        try:
            n = await fwd.step()
            if n:
                log.info("captured %d prompt(s)", n)
        except Exception as exc:  # noqa: BLE001
            # Throttle repeated failures (e.g. owner not signed in -> 409 every tick).
            now = loop.time()
            if now - last_err_log > 60:
                log.warning("capture forward paused (retrying): %s", exc)
                last_err_log = now
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=cfg.capture_interval)


async def _heartbeat_loop(
    cfg: Config, api: RunnerApi, run_id: str, cancel_event: asyncio.Event, stop: asyncio.Event
) -> None:
    while not stop.is_set():
        try:
            hb = await api.heartbeat(run_id)
            if hb.get("cancel_requested") or hb.get("status") == "canceled":
                cancel_event.set()
        except Exception as exc:  # noqa: BLE001
            log.warning("heartbeat failed for %s: %s", run_id, exc)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=cfg.heartbeat_interval)


async def _handle_run(
    cfg: Config, api: RunnerApi, run: dict, sem: asyncio.Semaphore, active: set[asyncio.Event]
) -> None:
    cancel_event = asyncio.Event()
    stop = asyncio.Event()
    active.add(cancel_event)
    hb = asyncio.create_task(_heartbeat_loop(cfg, api, run["id"], cancel_event, stop))
    try:
        log.info("run %s: %s step(s) in %s", run["id"], len(run.get("steps", [])), run.get("project_path"))
        await execute_run(cfg, api, run, cancel_event)
    except Exception as exc:  # noqa: BLE001
        log.exception("run %s failed", run["id"])
        with contextlib.suppress(Exception):
            await api.run_result(run["id"], "failed", error=f"runner error: {exc}"[:500])
    finally:
        stop.set()
        hb.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hb
        active.discard(cancel_event)
        sem.release()


async def run_forever(cfg: Config) -> None:
    api = RunnerApi(cfg)
    sem = asyncio.Semaphore(cfg.max_concurrency)
    shutdown = asyncio.Event()
    active_cancels: set[asyncio.Event] = set()
    tasks: set[asyncio.Task] = set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, shutdown.set)

    capture_task: asyncio.Task | None = None
    if cfg.capture_token:
        capture_task = asyncio.create_task(_capture_loop(cfg, api, shutdown))
        log.info("prompt capture on (spool: %s)", cfg.spool_path)

    delivery_task: asyncio.Task | None = None
    if cfg.deliver_enabled:
        delivery_task = asyncio.create_task(_delivery_loop(cfg, api, shutdown))
        log.info("cli delivery on (poll %.1fs)", cfg.deliver_interval)

    optimize_task: asyncio.Task | None = None
    if cfg.optimize_enabled:
        optimize_task = asyncio.create_task(_optimize_loop(cfg, api, shutdown))
        log.info("prompt optimization on (poll %.1fs)", cfg.optimize_interval)

    log.info(
        "cue-runner started → %s (concurrency=%d, long-poll %s)",
        cfg.api_url,
        cfg.max_concurrency,
        f"{cfg.long_poll_wait:.0f}s" if cfg.long_poll_wait > 0 else "off",
    )
    try:
        while not shutdown.is_set():
            await sem.acquire()
            if shutdown.is_set():
                sem.release()
                break
            started = loop.time()
            try:
                run = await until_stopped(api.claim(), shutdown)
            except Exception as exc:  # noqa: BLE001
                log.warning("claim failed: %s", exc)
                run = None
            if shutdown.is_set():
                sem.release()
                break
            if not run:
                sem.release()
                await _idle(shutdown, cfg.poll_interval, loop.time() - started)
                continue
            task = asyncio.create_task(_handle_run(cfg, api, run, sem, active_cancels))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    finally:
        # Graceful shutdown: cancel in-flight runs, let them report, then exit.
        for ev in list(active_cancels):
            ev.set()
        if tasks:
            with contextlib.suppress(Exception):
                await asyncio.wait(tasks, timeout=30)
        for extra in (capture_task, delivery_task, optimize_task):
            if extra:
                extra.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await extra
        await api.aclose()
        log.info("cue-runner stopped")
