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
