"""Optimization worker: claim one job, run it, report it — strictly serially.

Sequential by design (the batch requirement says "one after another, not in
parallel"), which also keeps CLI cost predictable. The loop never raises into
the daemon: a job it claimed is always resolved, even if the provider explodes.
"""
from __future__ import annotations

import logging

from .providers import OptimizationOutcome, get as get_provider

log = logging.getLogger("cue-runner.optimize")


async def optimize_one(cfg, api, job: dict) -> OptimizationOutcome:
    """Execute a single claimed job with the provider it asks for."""
    provider = get_provider(job.get("provider", ""), cfg.claude_path)
    if provider is None:
        return OptimizationOutcome(
            status="failed", error=f"Unbekannter Optimizer: {job.get('provider')}"
        )

    prompt = job.get("prompt") or ""
    max_chars = int(job.get("max_chars") or cfg.optimize_max_chars)
    if len(prompt) > max_chars:
        return OptimizationOutcome(
            status="failed",
            error=f"Prompt überschreitet das Limit ({len(prompt)} > {max_chars} Zeichen)",
        )

    timeout = float(job.get("timeout_s") or cfg.optimize_timeout)
    attempts = max(1, int(job.get("max_retries") or 0) + 1)
    outcome = OptimizationOutcome(status="failed", error="nicht ausgeführt")
    for attempt in range(1, attempts + 1):
        outcome = await provider.run(prompt, model=job.get("model") or "", timeout_s=timeout)
        if outcome.status == "succeeded":
            break
        log.warning(
            "optimization %s attempt %s/%s failed: %s",
            job.get("id"),
            attempt,
            attempts,
            outcome.error,
        )
    return outcome


async def run_next(cfg, api) -> bool:
    """Claim and process one job. Returns True when there was work to do."""
    job = await api.claim_optimization()
    if not job:
        return False

    log.info(
        "optimizing prompt %s (job %s, v%s, %s)",
        job.get("prompt_id"),
        job.get("id"),
        job.get("version"),
        job.get("provider"),
    )
    try:
        outcome = await optimize_one(cfg, api, job)
    except Exception as exc:  # noqa: BLE001 — a claimed job must never dangle
        log.exception("optimization %s crashed", job.get("id"))
        outcome = OptimizationOutcome(status="failed", error=f"Runner-Fehler: {exc}"[:400])

    await api.optimization_result(
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
            "optimized prompt %s in %sms (%s)",
            job.get("prompt_id"),
            outcome.duration_ms,
            outcome.model or "default model",
        )
    else:
        log.warning("optimization %s failed: %s", job.get("id"), outcome.error)
    return True
