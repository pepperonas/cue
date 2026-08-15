"""The two background loops in `app/main.py`.

Both used to swallow every exception with a bare `pass`. That keeps the loop
alive — which is right, one bad tick must not stop the cleanup forever — and it
keeps the failure invisible, which is not. A broken attachment GC means
screenshots outlive the 30 days the composer PROMISES the user and the volume
grows without bound; a broken reaper leaves prompts stuck in Running. Neither
was observable: no log line, no metric, nothing.
"""
from __future__ import annotations

import asyncio
import logging

import pytest


def _drive(loop_factory, *, ticks: int = 1) -> None:
    """Run one of the loops for a few iterations, then stop it.

    The loops sleep for a day / a minute, so the sleep is replaced rather than
    waited out; cancelling after `ticks` sleeps is what ends the run.
    """
    seen = {"n": 0}
    # Captured BEFORE the patch: `asyncio` is a single shared module, so a
    # `fake_sleep` that calls `asyncio.sleep` calls itself. That recursion made
    # an earlier version of this helper run the loop body exactly once no
    # matter what `ticks` said — and the flood test below passed vacuously.
    real_sleep = asyncio.sleep

    async def fake_sleep(_seconds):
        seen["n"] += 1
        if seen["n"] >= ticks:
            raise asyncio.CancelledError
        await real_sleep(0)

    async def scenario():
        import app.main as main_module

        main_module.asyncio.sleep = fake_sleep
        try:
            with pytest.raises(asyncio.CancelledError):
                await loop_factory(main_module)
        finally:
            main_module.asyncio.sleep = real_sleep

    asyncio.run(scenario())
    assert seen["n"] == ticks, f"the loop ran {seen['n']}x, expected {ticks}"


def test_a_failing_cleanup_is_logged_and_the_loop_survives(client, monkeypatch, caplog):
    import app.main as main_module
    from app.routers import attachments

    def boom(_session):
        raise RuntimeError("Festplatte voll")

    monkeypatch.setattr(attachments, "purge_expired", boom)

    with caplog.at_level(logging.ERROR):
        _drive(lambda m: m._attachment_gc_loop(), ticks=1)

    assert "attachment/event cleanup" in caplog.text
    assert "Festplatte voll" in caplog.text, "the cause has to be in the log, not just a label"
    assert "Traceback" in caplog.text
    assert main_module is not None


def test_a_failing_reaper_is_logged(client, monkeypatch, caplog):
    from app.routers import runs

    def boom(_session, _timeout):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(runs, "reap_stale", boom)

    with caplog.at_level(logging.ERROR):
        _drive(lambda m: m._run_reaper_loop(), ticks=1)

    assert "run/optimization reaper" in caplog.text
    assert "Datenbank weg" in caplog.text


def test_repeated_failures_do_not_flood_the_journal(client, monkeypatch, caplog):
    """The reaper ticks every 60 s. A permanent failure would otherwise write
    the same traceback 1.440 times a day and bury everything else."""
    from app.routers import runs

    def boom(_session, _timeout):
        raise RuntimeError("dauerhaft kaputt")

    monkeypatch.setattr(runs, "reap_stale", boom)

    with caplog.at_level(logging.ERROR):
        _drive(lambda m: m._run_reaper_loop(), ticks=5)

    records = [r for r in caplog.records if "reaper" in r.getMessage()]
    assert len(records) == 1, f"logged {len(records)}x for 5 consecutive failures"


def test_a_healthy_loop_logs_nothing(client, caplog):
    with caplog.at_level(logging.WARNING):
        _drive(lambda m: m._run_reaper_loop(), ticks=2)
    assert caplog.text == ""
