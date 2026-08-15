"""RunnerApi HTTP client tests — the wire is faked with httpx.MockTransport."""
from __future__ import annotations

import json

import httpx
import pytest

from cue_runner.api import RunnerApi
from cue_runner.config import Config


def _cfg() -> Config:
    return Config(
        api_url="https://cue.example",
        runner_token="runner-secret",
        allowed_bases=["/Users/martin/claude"],
        runner_id="test-runner",
        capture_token="capture-secret",
    )


def _api(handler) -> tuple[RunnerApi, list[httpx.Request]]:
    """RunnerApi whose client records requests and answers via `handler`."""
    requests: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    cfg = _cfg()
    api = RunnerApi(cfg)
    # Same base_url/headers as the real ctor, but no network.
    api.client = httpx.AsyncClient(
        base_url=cfg.api_url,
        headers={"Authorization": f"Bearer {cfg.runner_token}"},
        transport=httpx.MockTransport(recording_handler),
    )
    return api, requests


async def test_claim_sends_runner_id_and_bearer_token():
    api, requests = _api(lambda r: httpx.Response(200, json={"id": "r1", "steps": []}))
    run = await api.claim()
    assert run == {"id": "r1", "steps": []}
    req = requests[0]
    assert req.method == "POST" and req.url.path == "/api/runs/claim"
    assert req.headers["authorization"] == "Bearer runner-secret"
    assert json.loads(req.content) == {"runner_id": "test-runner"}
    await api.aclose()


async def test_claim_returns_none_when_queue_empty():
    api, _ = _api(lambda r: httpx.Response(204))
    assert await api.claim() is None
    await api.aclose()


async def test_claim_raises_on_server_error():
    api, _ = _api(lambda r: httpx.Response(500, text="boom"))
    with pytest.raises(httpx.HTTPStatusError):
        await api.claim()
    await api.aclose()


async def test_heartbeat_returns_status_payload():
    api, requests = _api(
        lambda r: httpx.Response(200, json={"status": "running", "cancel_requested": True})
    )
    hb = await api.heartbeat("r7")
    assert hb["cancel_requested"] is True
    assert requests[0].url.path == "/api/runs/r7/heartbeat"
    await api.aclose()


async def test_append_log_serializes_line_tuples():
    api, requests = _api(lambda r: httpx.Response(200, json={"ok": True}))
    await api.append_log("r1", 2, [("system", "init"), ("assistant", "pong")])
    body = json.loads(requests[0].content)
    assert body == {
        "step_index": 2,
        "lines": [
            {"event_type": "system", "line": "init"},
            {"event_type": "assistant", "line": "pong"},
        ],
    }
    await api.aclose()


async def test_step_result_payload_shape():
    api, requests = _api(lambda r: httpx.Response(200, json={"ok": True}))
    await api.step_result(
        "r1", 0, "succeeded", claude_session_id="s9", output="done", exit_code=0, cost_usd=0.02
    )
    assert requests[0].url.path == "/api/runs/r1/steps/0/result"
    body = json.loads(requests[0].content)
    assert body["status"] == "succeeded"
    assert body["claude_session_id"] == "s9"
    assert body["cost_usd"] == 0.02
    await api.aclose()


async def test_run_result_payload_shape():
    api, requests = _api(lambda r: httpx.Response(200, json={"ok": True}))
    await api.run_result("r1", "failed", total_cost_usd=1.5, error="step 1 failed")
    assert requests[0].url.path == "/api/runs/r1/result"
    assert json.loads(requests[0].content) == {
        "status": "failed",
        "total_cost_usd": 1.5,
        "error": "step 1 failed",
    }
    await api.aclose()


async def test_claim_delivery_both_outcomes():
    api, requests = _api(
        lambda r: httpx.Response(200, json={"id": 5, "transport": "iterm"})
    )
    d = await api.claim_delivery()
    assert d["transport"] == "iterm"
    assert requests[0].method == "GET" and requests[0].url.path == "/api/cli/claim"

    api204, _ = _api(lambda r: httpx.Response(204))
    assert await api204.claim_delivery() is None
    await api.aclose()
    await api204.aclose()


async def test_delivery_result_payload():
    api, requests = _api(lambda r: httpx.Response(204))
    await api.delivery_result(5, "failed", error="no such pane")
    assert requests[0].url.path == "/api/cli/5/result"
    assert json.loads(requests[0].content) == {"status": "failed", "error": "no such pane"}
    await api.aclose()


async def test_capture_uses_capture_token_not_runner_token():
    api, requests = _api(lambda r: httpx.Response(200, json={"stored": 1, "skipped": 0}))
    res = await api.capture([{"session_id": "s", "prompt": "hi", "seq": 1}])
    assert res == {"stored": 1, "skipped": 0}
    req = requests[0]
    assert req.url.path == "/api/capture"
    # The capture endpoint authenticates with its own token, not the runner's.
    assert req.headers["authorization"] == "Bearer capture-secret"
    await api.aclose()


async def test_capture_raises_on_failure_for_retry():
    """A failed POST must raise so the forwarder keeps its offset (at-least-once)."""
    api, _ = _api(lambda r: httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await api.capture([{"session_id": "s", "prompt": "hi", "seq": 1}])
    await api.aclose()


# ------------------------------------------------- reporting an optimization
#
# The most expensive payload this process carries: it cost CLI minutes and real
# money, and it exists nowhere else. Reporting it used to be fire-and-forget —
# no status check, no log — so a refused report vanished on both sides.


@pytest.mark.asyncio
async def test_a_result_is_delivered_once_when_the_server_accepts_it():
    api, requests = _api(lambda _r: httpx.Response(200, json={"id": 7}))
    await api.optimization_result(7, status="succeeded", optimized_text="besser")

    assert len(requests) == 1
    assert requests[0].url.path == "/api/optimizations/7/result"
    assert json.loads(requests[0].content)["optimized_text"] == "besser"


@pytest.mark.asyncio
async def test_a_transient_failure_is_retried(monkeypatch):
    """A deploy restarts the container; a report landing in that window used to
    be lost outright. It is worth several seconds to keep it."""
    monkeypatch.setattr("cue_runner.api._RESULT_BACKOFF_S", 0)
    answers = [httpx.Response(502), httpx.Response(502), httpx.Response(200, json={})]
    api, requests = _api(lambda _r: answers.pop(0))

    await api.optimization_result(7, status="succeeded", optimized_text="besser")
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_a_network_error_is_retried_too(monkeypatch):
    monkeypatch.setattr("cue_runner.api._RESULT_BACKOFF_S", 0)
    calls = {"n": 0}

    def handler(_request):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("connection refused")
        return httpx.Response(200, json={})

    api, requests = _api(handler)
    await api.optimization_result(7, status="succeeded", optimized_text="besser")
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_a_gone_job_is_final_and_is_logged_as_discarded(monkeypatch, caplog):
    """404 means the prompt was deleted while the CLI was still running. No
    amount of retrying brings the row back — but it must be said out loud,
    including what it cost."""
    monkeypatch.setattr("cue_runner.api._RESULT_BACKOFF_S", 0)
    api, requests = _api(lambda _r: httpx.Response(404, json={"detail": "not found"}))

    with caplog.at_level("WARNING"):
        await api.optimization_result(
            11, status="succeeded", optimized_text="besser", cost_usd=1.7
        )

    assert len(requests) == 1, "a 404 must not be retried"
    assert "discarded" in caplog.text
    assert "11" in caplog.text and "1.70 USD" in caplog.text


@pytest.mark.asyncio
async def test_giving_up_says_the_result_was_lost(monkeypatch, caplog):
    """The one line an operator needs to see when it really is gone."""
    monkeypatch.setattr("cue_runner.api._RESULT_BACKOFF_S", 0)
    api, requests = _api(lambda _r: httpx.Response(503))

    with caplog.at_level("ERROR"):
        await api.optimization_result(7, status="succeeded", optimized_text="x", cost_usd=0.6)

    assert len(requests) == 3
    assert "LOST" in caplog.text and "0.60 USD" in caplog.text


@pytest.mark.asyncio
async def test_reporting_never_raises_into_the_loop(monkeypatch):
    """Whatever happens to the report, the runner keeps working: the job is
    already done, and a crash here would take the next one down with it."""
    monkeypatch.setattr("cue_runner.api._RESULT_BACKOFF_S", 0)
    for handler in (
        lambda _r: httpx.Response(404),
        lambda _r: httpx.Response(500),
        lambda _r: (_ for _ in ()).throw(httpx.ConnectError("boom")),
    ):
        api, _ = _api(handler)
        await api.optimization_result(7, status="failed", error="x")
