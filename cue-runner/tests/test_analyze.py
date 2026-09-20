"""Die Analyse-Schleife des Runners.

Der Ausführer ist mit der Optimierung geteilt — geprüft wird deshalb genau das,
was sich unterscheidet: das Abholen, das Melden und dass ein übernommener Job
niemals hängen bleibt.
"""
from __future__ import annotations

import asyncio
import types

import pytest

from cue_runner import analyze
from cue_runner.optimize import OptimizationOutcome


class FakeApi:
    def __init__(self, jobs=None):
        self.jobs = list(jobs or [])
        self.results: list[dict] = []

    async def claim_analysis(self):
        job = self.jobs.pop(0) if self.jobs else None
        if isinstance(job, Exception):
            raise job
        return job

    async def analysis_result(self, analysis_id, **kw):
        self.results.append({"id": analysis_id, **kw})


def cfg():
    return types.SimpleNamespace(
        claude_path="claude", optimize_max_chars=200_000, optimize_timeout=60
    )


JOB = {"id": 7, "provider": "claude_cli", "prompt": "analysiere", "project_name": "demo"}


def run(coro):
    return asyncio.run(coro)


def test_an_empty_queue_is_not_work():
    api = FakeApi()
    assert run(analyze.run_next(cfg(), api)) is False
    assert api.results == []


def test_a_successful_run_is_reported_with_its_telemetry(monkeypatch):
    api = FakeApi([JOB])
    monkeypatch.setattr(
        analyze,
        "optimize_one",
        lambda *a, **k: _fertig(
            OptimizationOutcome(
                status="succeeded",
                text='{"reihenfolge": []}',
                model="claude-opus-5",
                duration_ms=900,
                cost_usd=0.5,
            )
        ),
    )
    assert run(analyze.run_next(cfg(), api)) is True
    (ergebnis,) = api.results
    assert ergebnis["id"] == 7
    assert ergebnis["status"] == "succeeded"
    assert ergebnis["optimized_text"] == '{"reihenfolge": []}'
    assert ergebnis["cost_usd"] == 0.5


def test_a_crashing_executor_still_reports():
    """Ein übernommener Job, der nie zurückmeldet, bliebe ewig auf „läuft"."""

    async def explodiert(*a, **k):
        raise RuntimeError("kaputt")

    api = FakeApi([JOB])
    import cue_runner.analyze as modul

    modul.optimize_one = explodiert
    try:
        assert run(analyze.run_next(cfg(), api)) is True
    finally:
        from cue_runner.optimize import optimize_one

        modul.optimize_one = optimize_one
    (ergebnis,) = api.results
    assert ergebnis["status"] == "failed"
    assert "Runner-Fehler" in ergebnis["error"]


def test_a_failed_run_is_reported_too(monkeypatch):
    api = FakeApi([JOB])
    monkeypatch.setattr(
        analyze,
        "optimize_one",
        lambda *a, **k: _fertig(OptimizationOutcome(status="failed", error="Kontingent")),
    )
    assert run(analyze.run_next(cfg(), api)) is True
    assert api.results[0]["status"] == "failed"
    assert api.results[0]["error"] == "Kontingent"


def test_the_executor_is_the_shared_one():
    """Die Zusicherung, die dieses Modul so klein hält.

    Würde hier ein zweiter Ausführer entstehen, liefen Zeitlimits, Wiederholungen
    und die Nicht-Wiederholbarkeit von Kontingentfehlern auseinander.
    """
    from cue_runner.optimize import optimize_one as geteilt

    import cue_runner.analyze as modul

    assert modul.optimize_one is geteilt


async def _fertig(outcome):
    return outcome
