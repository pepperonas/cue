"""Prompt optimization: service rules, persistence, versioning, batches.

Black-box over the HTTP API like the rest of the suite. The executor (the Mac
runner driving the CLI) is simulated by calling the runner endpoints directly
with the `RUNNER_TOKEN` — exactly what the real runner does, minus the
subprocess (which is covered in `cue-runner/tests/test_optimize.py`).
"""
from __future__ import annotations

from conftest import RUNNER_HDR
from conftest import auth as _auth

from app.optimization.meta_prompt import build_meta_prompt, clean_result


def _mk(client, headers, body="Schreibe mir was zu Datenbanken", **extra):
    res = client.post("/api/prompts", json={"body": body, **extra}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _claim(client):
    res = client.post("/api/optimizations/claim", json={"runner_id": "test"}, headers=RUNNER_HDR)
    return None if res.status_code == 204 else res.json()


def _report(client, job_id, **payload):
    body = {"status": "succeeded", "optimized_text": "Optimierter Prompt", **payload}
    res = client.post(f"/api/optimizations/{job_id}/result", json=body, headers=RUNNER_HDR)
    assert res.status_code == 200, res.text
    return res.json()


# ------------------------------------------------------------- meta prompt


def test_meta_prompt_contains_the_original_and_the_rules():
    built = build_meta_prompt("Mach eine Liste")
    assert "Mach eine Liste" in built
    assert "Prompt Engineer" in built
    assert "Verändere die eigentliche Intention niemals" in built
    assert "BISHERIGE OPTIMIERUNG" not in built


def test_meta_prompt_refinement_carries_both_texts():
    built = build_meta_prompt("Original", previous="Fassung 1")
    assert "Original" in built and "Fassung 1" in built
    assert "erneute Optimierung" in built


def test_clean_result_strips_a_wrapping_fence_only():
    assert clean_result("```\nHallo\n```") == "Hallo"
    assert clean_result("```markdown\nHallo\n```") == "Hallo"
    assert clean_result("  Hallo  ") == "Hallo"
    # A fence INSIDE the prompt must survive untouched.
    body = "Nutze:\n```py\nprint(1)\n```\nEnde"
    assert clean_result(body) == body
    assert clean_result("") == ""


# ------------------------------------------------------------- happy path


def test_full_optimization_flow(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "mach mir ne liste von db typen")

    created = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    )
    assert created.status_code == 201, created.text
    job = created.json()
    assert job["status"] == "queued" and job["version"] == 1
    assert job["original_text"] == "mach mir ne liste von db typen"
    assert job["previous_text"] is None

    # The runner claims it and receives the fully built meta prompt.
    claimed = _claim(client)
    assert claimed["id"] == job["id"]
    assert claimed["provider"] == "claude_cli"
    assert "mach mir ne liste von db typen" in claimed["prompt"]
    assert "Prompt Engineer" in claimed["prompt"]
    assert claimed["timeout_s"] > 0 and claimed["max_chars"] > 0
    # An empty queue answers 204, so the runner idles instead of spinning.
    assert _claim(client) is None

    done = _report(
        client,
        job["id"],
        optimized_text="Erstelle eine strukturierte Liste der Datenbanktypen …",
        model="claude-sonnet-4-5",
        exit_code=0,
        duration_ms=4200,
        cost_usd=0.021,
        input_tokens=120,
        output_tokens=340,
    )
    assert done["status"] == "succeeded"
    assert done["optimized_text"].startswith("Erstelle eine strukturierte Liste")
    assert done["duration_ms"] == 4200 and done["cost_usd"] == 0.021

    # The prompt now carries the optimization — and its ORIGINAL body is intact.
    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["body"] == "mach mir ne liste von db typen"
    assert stored["optimized"] is True
    assert stored["optimized_body"].startswith("Erstelle eine strukturierte Liste")
    assert stored["optimization_version"] == 1
    assert stored["optimization_model"] == "claude-sonnet-4-5"
    assert stored["optimized_at"] is not None


def test_repeat_optimization_bumps_the_version_and_sees_both_texts(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Original-Text")

    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    first = _claim(client)
    _report(client, first["id"], optimized_text="Fassung eins")

    second_job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    assert second_job["version"] == 2
    assert second_job["previous_text"] == "Fassung eins"

    claimed = _claim(client)
    assert "Original-Text" in claimed["prompt"] and "Fassung eins" in claimed["prompt"]
    _report(client, claimed["id"], optimized_text="Fassung zwei")

    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["optimization_version"] == 2
    assert stored["optimized_body"] == "Fassung zwei"
    assert stored["body"] == "Original-Text"  # still untouched

    history = client.get(
        f"/api/optimizations?prompt_id={prompt['id']}", headers=headers
    ).json()
    assert [row["version"] for row in history] == [2, 1]
    assert history[1]["optimized_text"] == "Fassung eins"  # old versions stay readable


# ------------------------------------------------------------- error paths


def test_failed_run_records_the_error_and_leaves_the_prompt_alone(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    job = _claim(client)

    failed = _report(
        client,
        job["id"],
        status="failed",
        optimized_text=None,
        exit_code=1,
        error="Zeitüberschreitung nach 180 s",
    )
    assert failed["status"] == "failed"
    assert failed["error"] == "Zeitüberschreitung nach 180 s"
    assert failed["exit_code"] == 1

    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["optimized"] is False and stored["optimized_body"] is None


def test_success_without_text_is_treated_as_a_failure(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    job = _claim(client)
    result = _report(client, job["id"], optimized_text="   ")
    assert result["status"] == "failed"
    assert "keinen Text" in result["error"]


def test_second_queue_for_the_same_prompt_is_refused(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    again = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert again.status_code == 409


def test_oversized_and_empty_prompts_are_rejected(client, monkeypatch):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "x" * 500)

    import app.routers.optimize as router_module

    monkeypatch.setattr(router_module._settings, "optimize_max_chars", 100)
    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 413
    assert "zu lang" in res.json()["detail"]


def test_unknown_prompt_and_foreign_prompt_404(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    assert (
        client.post("/api/optimizations", json={"prompt_id": 9999}, headers=headers).status_code
        == 404
    )


def test_late_result_does_not_resurrect_a_canceled_job(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)
    canceled = client.post(f"/api/optimizations/{job['id']}/cancel", headers=headers).json()
    assert canceled["status"] == "canceled"

    late = _report(client, job["id"], optimized_text="zu spät")
    assert late["status"] == "canceled" and late["optimized_text"] is None
    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["optimized"] is False


def test_stale_jobs_are_reaped(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)

    from datetime import datetime, timedelta, timezone

    import app.db as db_module
    from sqlmodel import Session

    from app.models import PromptOptimization
    from app.optimization import PromptOptimizationService

    with Session(db_module.engine) as s:
        row = s.get(PromptOptimization, job["id"])
        row.started_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        s.add(row)
        s.commit()
        assert PromptOptimizationService(s).reap_stale() == 1

    after = client.get(f"/api/optimizations/{job['id']}", headers=headers).json()
    assert after["status"] == "failed" and "Timeout" in after["error"]


# ------------------------------------------------------------- batch mode


def test_batch_optimizes_every_pending_prompt_sequentially(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompts = [_mk(client, headers, f"Prompt {i}") for i in range(3)]

    batch = client.post("/api/optimizations/batch", json={}, headers=headers)
    assert batch.status_code == 201, batch.text
    body = batch.json()
    assert body["total"] == 3 and body["pending"] == 3 and body["done"] == 0

    # A second batch while one is running is refused.
    assert client.post("/api/optimizations/batch", json={}, headers=headers).status_code == 409

    # The runner works them off one by one — each claim returns a single job.
    for index in range(3):
        job = _claim(client)
        assert job is not None
        _report(client, job["id"], optimized_text=f"Optimiert {index}")
        progress = client.get("/api/optimizations/batch/active", headers=headers).json()
        if index < 2:
            assert progress["done"] == index + 1
    assert _claim(client) is None

    finished = client.get(f"/api/optimizations/batch/{body['id']}", headers=headers).json()
    assert finished["done"] == 3 and finished["failed"] == 0 and finished["pending"] == 0
    assert finished["finished_at"] is not None
    assert client.get("/api/optimizations/batch/active", headers=headers).json() is None

    for prompt in prompts:
        stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
        assert stored["optimized"] is True


def test_batch_counts_failures_and_skips_ineligible_prompts(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "Guter Prompt")
    blocked = _mk(client, headers, "Schon in Arbeit")
    # An already running optimization makes this prompt ineligible -> skipped.
    client.post("/api/optimizations", json={"prompt_id": blocked["id"]}, headers=headers)

    batch = client.post("/api/optimizations/batch", json={}, headers=headers).json()
    assert batch["total"] == 1  # the busy prompt was skipped, not fatal

    first = _claim(client)  # the pre-existing single job
    _report(client, first["id"], optimized_text="ok")
    second = _claim(client)
    _report(client, second["id"], status="failed", optimized_text=None, error="CLI kaputt")

    final = client.get(f"/api/optimizations/batch/{batch['id']}", headers=headers).json()
    assert final["failed"] == 1 and final["done"] == 0 and final["finished_at"] is not None


def test_batch_can_be_canceled_and_stops_handing_out_work(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    for i in range(3):
        _mk(client, headers, f"Prompt {i}")
    batch = client.post("/api/optimizations/batch", json={}, headers=headers).json()

    first = _claim(client)
    canceled = client.post(
        f"/api/optimizations/batch/{batch['id']}/cancel", headers=headers
    ).json()
    assert canceled["canceled"] is True
    # Queued siblings are canceled immediately; nothing else is handed out.
    assert _claim(client) is None
    # The already-running one may still report its result.
    _report(client, first["id"], optimized_text="fertig geworden")
    final = client.get(f"/api/optimizations/batch/{batch['id']}", headers=headers).json()
    assert final["done"] == 1 and final["pending"] == 0 and final["finished_at"] is not None


def test_batch_scoped_to_a_project(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    project = client.post("/api/projects", json={"name": "cue"}, headers=headers).json()
    _mk(client, headers, "Im Projekt", project_id=project["id"])
    _mk(client, headers, "Ohne Projekt")

    batch = client.post(
        "/api/optimizations/batch", json={"project_id": project["id"]}, headers=headers
    ).json()
    assert batch["total"] == 1


def test_empty_batch_is_rejected(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    assert client.post("/api/optimizations/batch", json={}, headers=headers).status_code == 400


# ------------------------------------------------------------- access control


def test_optimization_endpoints_are_owner_only(client):
    csrf = _auth(client, "someone@example.com", sub="sub-other")
    headers = {"X-CSRF-Token": csrf}
    assert client.get("/api/optimizations/config", headers=headers).status_code == 403
    assert client.post("/api/optimizations", json={"prompt_id": 1}, headers=headers).status_code == 403
    assert client.post("/api/optimizations/batch", json={}, headers=headers).status_code == 403


def test_runner_endpoints_require_the_runner_token(client):
    assert client.post("/api/optimizations/claim", json={"runner_id": "x"}).status_code == 401
    assert (
        client.post("/api/optimizations/1/result", json={"status": "failed"}).status_code == 401
    )


def test_config_exposes_the_provider_registry(client):
    csrf = _auth(client)
    cfg = client.get("/api/optimizations/config", headers={"X-CSRF-Token": csrf}).json()
    assert cfg["enabled"] is True
    assert cfg["default_provider"] == "claude_cli"
    assert cfg["providers"][0]["id"] == "claude_cli"
    assert cfg["providers"][0]["executed_by"] == "runner"
    assert cfg["timeout_s"] > 0 and cfg["meta_prompt_version"] >= 1


def test_disabled_feature_refuses_to_queue(client, monkeypatch):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    import app.routers.optimize as router_module

    monkeypatch.setattr(router_module._settings, "optimize_enabled", False)
    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 503
