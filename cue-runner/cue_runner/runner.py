"""Runner daemon: poll cue, claim runs, execute them, report results."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

from .api import RunnerApi
from .capture import CaptureForwarder
from .config import Config
from .executor import execute_run

log = logging.getLogger("cue-runner")


async def _capture_loop(cfg: Config, api: RunnerApi, stop: asyncio.Event) -> None:
    """Forward prompts written to the spool by the UserPromptSubmit hook."""
    fwd = CaptureForwarder(cfg, api)
    while not stop.is_set():
        try:
            n = await fwd.step()
            if n:
                log.info("captured %d prompt(s)", n)
        except Exception as exc:  # noqa: BLE001
            log.warning("capture forward failed: %s", exc)
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
        if capture_task:
            capture_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await capture_task
        await api.aclose()
        log.info("cue-runner stopped")
