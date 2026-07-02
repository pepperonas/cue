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

log = logging.getLogger("cue-runner")


async def _delivery_loop(cfg: Config, api: RunnerApi, stop: asyncio.Event) -> None:
    """Poll for prompts to type back into a live terminal session and perform them."""
    last_err_log = 0.0
    loop = asyncio.get_event_loop()
    while not stop.is_set():
        worked = False
        try:
            d = await api.claim_delivery()
            if d:
                worked = True
                status, error = await deliver_one(d)
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
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=cfg.deliver_interval)


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

    log.info("cue-runner started → %s (concurrency=%d)", cfg.api_url, cfg.max_concurrency)
    try:
        while not shutdown.is_set():
            await sem.acquire()
            if shutdown.is_set():
                sem.release()
                break
            try:
                run = await api.claim()
            except Exception as exc:  # noqa: BLE001
                log.warning("claim failed: %s", exc)
                run = None
            if not run:
                sem.release()
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(shutdown.wait(), timeout=cfg.poll_interval)
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
        for extra in (capture_task, delivery_task):
            if extra:
                extra.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await extra
        await api.aclose()
        log.info("cue-runner stopped")
