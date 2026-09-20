"""Projekt-Analysen auf dem Runner.

Bewusst winzig: der Ausführer ist bereits generisch. `optimize_one` bekommt
einen Job mit `prompt`, `provider`, `model`, `timeout_s` und liefert Text
zurück — es weiß nicht, ob der Text ein umgeschriebener Prompt oder ein
Ablaufplan ist. Genau deshalb braucht die Analyse hier keinen zweiten
Ausführer, sondern nur ein zweites Ziel zum Abholen und Melden.
"""
from __future__ import annotations

import logging

from .optimize import OptimizationOutcome, optimize_one

log = logging.getLogger("cue-runner.analyze")


async def run_next(cfg, api) -> bool:
    """Einen Analyse-Job übernehmen und abarbeiten. True, wenn es Arbeit gab."""
    job = await api.claim_analysis()
    if not job:
        return False

    log.info(
        "analysiere Projekt %r (Job %s, %s)",
        job.get("project_name") or "?",
        job.get("id"),
        job.get("provider"),
    )
    try:
        outcome = await optimize_one(cfg, api, job)
    except Exception as exc:  # noqa: BLE001 — ein übernommener Job darf nie hängen bleiben
        log.exception("Analyse %s abgestürzt", job.get("id"))
        outcome = OptimizationOutcome(status="failed", error=f"Runner-Fehler: {exc}"[:400])

    await api.analysis_result(
        job["id"],
        status=outcome.status,
        optimized_text=outcome.text,
        model=outcome.model,
        exit_code=outcome.exit_code,
        duration_ms=outcome.duration_ms,
        cost_usd=outcome.cost_usd,
        input_tokens=outcome.input_tokens,
        output_tokens=outcome.output_tokens,
        error=outcome.error,
    )
    if outcome.status == "succeeded":
        log.info(
            "Analyse %s fertig in %sms (%s)",
            job.get("id"),
            outcome.duration_ms,
            outcome.model or "Standardmodell",
        )
    else:
        log.warning("Analyse %s gescheitert: %s", job.get("id"), outcome.error)
    return True
