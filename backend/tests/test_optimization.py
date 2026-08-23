"""Prompt optimization: service rules, persistence, versioning, batches.

Black-box over the HTTP API like the rest of the suite. The executor (the Mac
runner driving the CLI) is simulated by calling the runner endpoints directly
with the `RUNNER_TOKEN` — exactly what the real runner does, minus the
subprocess (which is covered in `cue-runner/tests/test_optimize.py`).
"""
from __future__ import annotations

import pytest
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


def test_universal_meta_prompt_asks_for_a_project_agnostic_rewrite():
    built = build_meta_prompt("Räume src/api auf", universal=True)
    assert "Räume src/api auf" in built
    assert "UNIVERSELL" in built
    assert "Platzhalter" in built
    # The two goals are alternatives: the standard rule about keeping paths and
    # proper nouns verbatim would contradict the whole point here.
    assert "Behalte Codeblöcke, Pfade, Befehle und Eigennamen unverändert bei" not in built


def test_universal_mode_draws_the_line_at_project_boundness_not_at_concreteness():
    """The first wording generalized the author's own data away.

    It said "replace company and product names", so a bookmark carrying the
    user's own Google-Maps review link came back with `<Bewertungs-Link>` — a
    placeholder they would have to fill with the same value forever. What
    varies is the PROJECT, not the author.
    """
    built = build_meta_prompt("Verlinke https://g.page/r/xyz/review", universal=True)
    assert "ändert sich der Wert von" in built  # the actual criterion
    assert "Im Zweifel behalte den Wert" in built  # bias towards keeping
    # Owner-bound data is named as something to KEEP, not to replace.
    assert "UNVERÄNDERT übernehmen" in built
    assert "Ersetze konkrete Pfade sowie Projekt-, Repository-, Firmen-" not in built


def test_universal_refinement_keeps_both_texts_and_the_universal_goal():
    built = build_meta_prompt("Original", previous="Fassung 1", universal=True)
    assert "Original" in built and "Fassung 1" in built
    assert "erneute Optimierung" in built
    assert "UNIVERSELL" in built


def test_standard_mode_is_unchanged_and_never_asks_for_placeholders():
    built = build_meta_prompt("Räume src/api auf")
    assert "UNIVERSELL" not in built
    assert "Behalte Codeblöcke, Pfade, Befehle und Eigennamen unverändert bei" in built


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


# ------------------------------------------------- universal mode (bookmarks)


def test_bookmarked_prompts_are_optimized_universally(client):
    """A bookmark is the reusable shelf, so its optimization must fit any project."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Räume /Users/martin/claude/cue/src auf")
    client.patch(f"/api/prompts/{prompt['id']}", json={"bookmarked": True}, headers=headers)

    job = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert job.status_code == 201, job.text
    assert job.json()["universal"] is True

    claimed = client.post("/api/optimizations/claim", json={"runner_id": "r1"}, headers=RUNNER_HDR)
    assert claimed.status_code == 200, claimed.text
    assert "UNIVERSELL" in claimed.json()["prompt"]


def test_unbookmarked_prompts_keep_the_sharpening_optimization(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Räume /Users/martin/claude/cue/src auf")

    job = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert job.json()["universal"] is False

    claimed = client.post("/api/optimizations/claim", json={"runner_id": "r1"}, headers=RUNNER_HDR)
    assert "UNIVERSELL" not in claimed.json()["prompt"]


def test_the_mode_is_recorded_per_attempt_not_per_prompt(client):
    """Bookmarking can change between two runs; the history must stay honest."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Ein Prompt")

    first = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers).json()
    client.post("/api/optimizations/claim", json={"runner_id": "r1"}, headers=RUNNER_HDR)
    client.post(
        f"/api/optimizations/{first['id']}/result",
        json={"status": "succeeded", "optimized_text": "v1", "exit_code": 0},
        headers=RUNNER_HDR,
    )

    client.patch(f"/api/prompts/{prompt['id']}", json={"bookmarked": True}, headers=headers)
    second = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()

    assert first["universal"] is False
    assert second["universal"] is True
    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    assert [h["universal"] for h in sorted(history, key=lambda h: h["version"])] == [False, True]


# --------------------------------------------------- reviewing a proposal


def _finish(client, headers, prompt_id, text="Optimierte Fassung"):
    """Queue, claim and complete one optimization; returns the attempt."""
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt_id}, headers=headers
    ).json()
    client.post("/api/optimizations/claim", json={"runner_id": "r"}, headers=RUNNER_HDR)
    res = client.post(
        f"/api/optimizations/{job['id']}/result",
        json={"status": "succeeded", "optimized_text": text, "exit_code": 0},
        headers=RUNNER_HDR,
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_a_finished_optimization_is_only_a_proposal(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"])

    assert job["decision"] == "pending"
    after = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert after["body"] == "Originaltext"  # untouched until reviewed
    assert after["optimized"] is True
    assert after["optimized_body"] == "Optimierte Fassung"


def test_applying_moves_the_text_into_the_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"])

    res = client.post(f"/api/optimizations/{job['id']}/apply", headers=headers)
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["optimization"]["decision"] == "applied"
    assert payload["optimization"]["decided_at"] is not None
    # The prompt comes back in the same response, already updated.
    assert payload["prompt"]["body"] == "Optimierte Fassung"
    assert payload["prompt"]["optimized"] is False
    assert payload["prompt"]["optimized_body"] is None

    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["body"] == "Optimierte Fassung"


def test_discarding_leaves_the_prompt_alone(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"])

    payload = client.post(f"/api/optimizations/{job['id']}/discard", headers=headers).json()
    assert payload["optimization"]["decision"] == "discarded"
    assert payload["prompt"]["body"] == "Originaltext"
    assert payload["prompt"]["optimized"] is False


def test_the_history_keeps_the_discarded_text_for_a_second_look(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"], text="Verworfene Fassung")
    client.post(f"/api/optimizations/{job['id']}/discard", headers=headers)

    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    assert history[0]["optimized_text"] == "Verworfene Fassung"
    assert history[0]["decision"] == "discarded"


def test_a_decision_can_only_be_taken_once(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"])

    assert client.post(f"/api/optimizations/{job['id']}/apply", headers=headers).status_code == 200
    again = client.post(f"/api/optimizations/{job['id']}/discard", headers=headers)
    assert again.status_code == 409


def test_an_unfinished_optimization_cannot_be_applied(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()

    res = client.post(f"/api/optimizations/{job['id']}/apply", headers=headers)
    assert res.status_code == 400


def test_re_optimizing_after_applying_starts_from_the_new_text(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    first = _finish(client, headers, prompt["id"], text="Fassung 1")
    client.post(f"/api/optimizations/{first['id']}/apply", headers=headers)

    second = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    assert second["original_text"] == "Fassung 1"


def test_another_tenant_cannot_decide_my_optimization(client):
    """The decision endpoints write into a prompt — they must be scoped too."""
    csrf = _auth(client, "owner@example.com")
    owner_session = client.cookies.get("cue_session")
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Mein Prompt")
    job = _finish(client, headers, prompt["id"], text="Meine Fassung")

    other_csrf = _auth(client, "intruder@example.com", sub="intruder-sub")
    for action in ("apply", "discard"):
        res = client.post(
            f"/api/optimizations/{job['id']}/{action}", headers={"X-CSRF-Token": other_csrf}
        )
        # Owner-only feature: a foreign caller is refused, never served a 200.
        assert res.status_code in (403, 404), f"{action}: {res.status_code}"

    client.cookies.set("cue_session", owner_session)
    mine = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert mine["body"] == "Mein Prompt"  # untouched
    assert mine["optimized"] is True  # still awaiting MY decision


def test_deciding_an_unknown_optimization_is_a_404(client):
    csrf = _auth(client)
    res = client.post("/api/optimizations/999999/apply", headers={"X-CSRF-Token": csrf})
    assert res.status_code == 404


def test_an_empty_prompt_cannot_be_optimized(client):
    """Guard for the batch path: a blank body would waste a CLI call."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Noch Inhalt")
    client.patch(f"/api/prompts/{prompt['id']}", json={"body": "   "}, headers=headers)

    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 400


def test_clean_result_leaves_an_unclosed_fence_alone():
    """Models sometimes open a fence and never close it — that is content."""
    assert clean_result("```markdown\nHallo") == "```markdown\nHallo"
    assert clean_result("```") == "```"


def test_only_one_proposal_can_be_open_per_prompt(client):
    """Optimizing twice without deciding must not leave two applicable rows.

    Both stayed `pending`: the prompt showed v2 while v1 remained applicable,
    so taking the older one over wrote text that was never in the diff.
    """
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Original")
    first = _finish(client, headers, prompt["id"], text="Fassung 1")
    _finish(client, headers, prompt["id"], text="Fassung 2")

    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    by_version = {row["version"]: row for row in history}
    assert by_version[2]["decision"] == "pending"
    assert by_version[1]["decision"] == "superseded"
    assert by_version[1]["decided_at"] is not None

    # The replaced one can no longer overwrite the prompt.
    res = client.post(f"/api/optimizations/{first['id']}/apply", headers=headers)
    assert res.status_code == 409
    assert client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()["body"] == "Original"


def test_superseding_keeps_the_replaced_text_readable(client):
    """It was never reviewed, so the history has to preserve what it said."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Original")
    _finish(client, headers, prompt["id"], text="Verdrängte Fassung")
    _finish(client, headers, prompt["id"], text="Neue Fassung")

    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    replaced = next(row for row in history if row["version"] == 1)
    assert replaced["optimized_text"] == "Verdrängte Fassung"


def test_a_decided_proposal_is_not_superseded_again(client):
    """An applied version keeps its outcome when the next run finishes."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Original")
    first = _finish(client, headers, prompt["id"], text="Fassung 1")
    client.post(f"/api/optimizations/{first['id']}/apply", headers=headers)
    _finish(client, headers, prompt["id"], text="Fassung 2")

    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    assert next(r for r in history if r["version"] == 1)["decision"] == "applied"
    assert next(r for r in history if r["version"] == 2)["decision"] == "pending"


def test_superseding_only_touches_the_same_prompt(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "Prompt A")
    b = _mk(client, headers, "Prompt B")
    _finish(client, headers, a["id"], text="A1")
    _finish(client, headers, b["id"], text="B1")
    _finish(client, headers, b["id"], text="B2")

    a_hist = client.get(f"/api/optimizations?prompt_id={a['id']}", headers=headers).json()
    assert a_hist[0]["decision"] == "pending"  # untouched by B's second run


# --------------------------------------------------- which model does the work
#
# `OPTIMIZE_MODEL` is the setting that decides what rewrites a prompt. It ran
# EMPTY in production until 0.39.0, which does not fail — it silently hands the
# job to whatever the runner Mac's Claude Code happens to be set to, so a
# `/model` there changed the optimizer without a trace in cue. These pin the
# path from the setting to the runner, and the distinction between the model
# that was ASKED for and the one that actually answered.


def test_the_configured_model_reaches_the_runner(client, monkeypatch):
    """The whole point of pinning it: the setting has to arrive in the job.

    Patched on the router's own Settings instance — it is captured at import,
    so overriding the environment afterwards would change nothing (which is
    itself worth knowing before someone tries it in production).
    """
    import app.routers.optimize as optimize_router

    monkeypatch.setattr(optimize_router._settings, "optimize_model", "opus")

    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "irgendwas")
    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)

    assert _claim(client)["model"] == "opus"


def test_an_unset_model_stays_empty_rather_than_guessing(client):
    """Empty means "let the CLI decide" and must NOT become a hard-coded name.

    Someone tidying this up into a default would pin the model in code, where
    an operator cannot change it — the knob exists so the deployment decides.
    """
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "irgendwas")
    client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)

    # The test env sets no OPTIMIZE_MODEL, and the claude_cli provider declares
    # no default_model — so nothing is asked for.
    assert _claim(client)["model"] == ""

    from app.optimization import providers

    assert providers.get("claude_cli").default_model == ""


def test_the_history_records_the_model_that_answered_not_the_one_asked_for(client):
    """An alias is not a model name: `opus` resolves to something like
    `claude-opus-5[1m]`, and only the runner learns which. Storing the request
    would make the history claim a model that never ran."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "irgendwas")
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)

    done = _report(client, job["id"], optimized_text="besser", model="claude-opus-5[1m]")

    assert done["model"] == "claude-opus-5[1m]"
    stored = client.get(f"/api/prompts/{prompt['id']}", headers=headers).json()
    assert stored["optimization_model"] == "claude-opus-5[1m]"


def test_every_attempt_keeps_its_own_model(client):
    """Two versions of one prompt can come from two different models — that is
    exactly what an unpinned setting produced, and the history has to show it
    per attempt rather than only the newest."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "irgendwas")

    first = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)
    _report(client, first["id"], optimized_text="v1", model="claude-fable-5")

    second = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)
    _report(client, second["id"], optimized_text="v2", model="claude-opus-5")

    history = client.get(f"/api/optimizations?prompt_id={prompt['id']}", headers=headers).json()
    by_version = {row["version"]: row["model"] for row in history}
    assert by_version == {1: "claude-fable-5", 2: "claude-opus-5"}


# ------------------------------------------------- deleting a prompt mid-flight
#
# Found in the production logs: `POST /api/optimizations/11/result -> 404`, with
# the job ids from that evening absent from the database. Deleting a prompt
# takes its optimization history with it (`prompt_id` is NOT NULL, so unlike a
# RunStep these cannot be detached) — the executor was still working, and its
# answer had nowhere to land. Two things have to hold around that.


def test_deleting_a_prompt_settles_a_running_optimization(client):
    """The row goes, but not while the rest of the system still counts on it."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "wird gleich geloescht")
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)  # the runner is now working on it

    assert client.delete(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 204

    # The late report is refused — cleanly, and without a 500.
    late = client.post(
        f"/api/optimizations/{job['id']}/result",
        json={"status": "succeeded", "optimized_text": "zu spaet"},
        headers=RUNNER_HDR,
    )
    assert late.status_code == 404, late.text


def test_deleting_the_last_outstanding_prompt_finishes_its_batch(client):
    """The stuck progress pill.

    `_finish_batch_if_done` used to run only when a job reported or was
    cancelled. Delete the prompt of the last pending job and there was no job
    left to trigger it: `finished_at` stayed null, so the ticker polled every
    two seconds for a batch that could never complete.
    """
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    first = _mk(client, headers, "eins")
    second = _mk(client, headers, "zwei")

    batch = client.post("/api/optimizations/batch", json={}, headers=headers).json()
    assert batch["total"] == 2

    job = _claim(client)
    _report(client, job["id"], optimized_text="fertig")

    # The remaining prompt is deleted before its job ever runs.
    remaining = second["id"] if job["prompt_id"] == first["id"] else first["id"]
    assert client.delete(f"/api/prompts/{remaining}", headers=headers).status_code == 204

    active = client.get("/api/optimizations/batch/active", headers=headers).json()
    assert active is None, "the batch is still advertised as running"


def test_deleting_a_prompt_with_only_finished_optimizations_still_works(client):
    """The ordinary case must not regress: no FK error, no leftovers."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "fertig optimiert")
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    _claim(client)
    _report(client, job["id"], optimized_text="besser")

    assert client.delete(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/prompts/{prompt['id']}", headers=headers).status_code == 404


# --------------------------------------------------- only the queue is eligible


def _move(client, headers, prompt_id, status):
    r = client.patch(f"/api/prompts/{prompt_id}", json={"status": status}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("status", ["running", "done", "failed", "archived"])
def test_only_queued_prompts_can_be_optimized(client, status):
    """Optimizing rewrites the text you are ABOUT to send.

    Once a prompt has run, that text is history — offering the rewrite there
    spends money on a result nobody will use.
    """
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    _move(client, headers, prompt["id"], status)

    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 400, res.text
    assert "Queue" in res.json()["detail"]


def test_a_prompt_moved_back_to_the_queue_is_eligible_again(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    _move(client, headers, prompt["id"], "done")
    _move(client, headers, prompt["id"], "queued")

    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 201, res.text


def test_the_batch_takes_the_queue_and_nothing_else(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    queued = [_mk(client, headers, f"Queued {i}") for i in range(2)]
    for status in ("running", "done", "archived"):
        _move(client, headers, _mk(client, headers, f"Weg {status}")["id"], status)

    batch = client.post("/api/optimizations/batch", json={}, headers=headers).json()
    assert batch["total"] == len(queued), batch

    jobs = client.get("/api/optimizations", headers=headers).json()
    assert {j["prompt_id"] for j in jobs} == {p["id"] for p in queued}


def test_an_empty_queue_is_refused_by_name(client):
    """With only the queue eligible this is the common case, so the message has
    to say WHICH prompts were not found."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _move(client, headers, _mk(client, headers, "Erledigt")["id"], "done")

    res = client.post("/api/optimizations/batch", json={}, headers=headers)
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "Keine Prompts in der Queue zum Optimieren"


def test_a_pending_proposal_survives_the_prompt_leaving_the_queue(client):
    """Moving a prompt must not strand a finished rewrite it never decided on."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers, "Originaltext")
    job = _finish(client, headers, prompt["id"], "Bessere Fassung")
    _move(client, headers, prompt["id"], "running")

    applied = client.post(f"/api/optimizations/{job['id']}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    assert applied.json()["prompt"]["body"] == "Bessere Fassung"
