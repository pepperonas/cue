"""Behavior tests for the runner's orchestration loops (runner.py).

Everything runs against a fake in-memory API — no network, no subprocesses.
"""
from __future__ import annotations

import asyncio
import os
import signal

import pytest

from cue_runner import runner as runner_mod
from cue_runner.config import Config


def _cfg(**overrides) -> Config:
    cfg = Config(
        api_url="https://cue.test",
        runner_token="tok",
        allowed_bases=["/tmp"],
        runner_id="test-runner",
        poll_interval=0.01,
        heartbeat_interval=0.01,
        max_concurrency=2,
        capture_token="",
        spool_path="/tmp/spool.jsonl",
        capture_state_path="/tmp/state.json",
        capture_interval=0.01,
        deliver_enabled=False,
        deliver_interval=0.01,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


class FakeApi:
    """Programmable stand-in for RunnerApi."""

    def __init__(self, cfg=None, runs=None, deliveries=None):
        self.runs = list(runs or [])
        self.deliveries = list(deliveries or [])
        self.results: list[tuple] = []
        self.delivery_results: list[tuple] = []
        self.heartbeats: list[str] = []
        self.cancel_on_heartbeat = False
        self.closed = False

    async def claim(self):
        return self.runs.pop(0) if self.runs else None

    async def claim_delivery(self):
        d = self.deliveries.pop(0) if self.deliveries else None
        if isinstance(d, Exception):
            raise d
        return d

    async def delivery_result(self, delivery_id, status, error=None):
        self.delivery_results.append((delivery_id, status, error))

    async def heartbeat(self, run_id):
        self.heartbeats.append(run_id)
        return {"status": "running", "cancel_requested": self.cancel_on_heartbeat}

    async def run_result(self, run_id, status, total_cost_usd=None, error=None):
        self.results.append((run_id, status, error))

    async def aclose(self):
        self.closed = True


# ------------------------------------------------------------ delivery loop --
@pytest.mark.asyncio
async def test_delivery_loop_resolves_claims_and_survives_poll_errors(monkeypatch):
    api = FakeApi(deliveries=[
        {"id": 1, "transport": "iterm"},
        RuntimeError("api briefly down"),  # poll error -> logged + retried
        {"id": 2, "transport": "tmux"},
    ])
    outcomes = iter([("sent", None), ("failed", "no pane")])
    monkeypatch.setattr(runner_mod, "deliver_one", lambda d: _resolved(next(outcomes)))
    stop = asyncio.Event()

    task = asyncio.create_task(runner_mod._delivery_loop(_cfg(), api, stop))
    for _ in range(200):
        if len(api.delivery_results) >= 2:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, timeout=2)

    assert api.delivery_results == [(1, "sent", None), (2, "failed", "no pane")]


async def _resolved(value):
    return value


@pytest.mark.asyncio
async def test_delivery_loop_resolves_even_when_transport_raises(monkeypatch):
    api = FakeApi(deliveries=[{"id": 7, "transport": "iterm"}])

    async def boom(d):
        raise OSError("osascript missing")

    monkeypatch.setattr(runner_mod, "deliver_one", boom)
    stop = asyncio.Event()
    task = asyncio.create_task(runner_mod._delivery_loop(_cfg(), api, stop))
    for _ in range(200):
        if api.delivery_results:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, timeout=2)

    (did, status, error) = api.delivery_results[0]
    assert did == 7 and status == "failed" and "osascript missing" in error


# ------------------------------------------------------------- capture loop --
@pytest.mark.asyncio
async def test_capture_loop_steps_and_throttles_errors(monkeypatch):
    calls = {"n": 0}

    class FakeForwarder:
        def __init__(self, cfg, api):
            pass

        async def step(self):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("cue not reachable")  # must not kill the loop
            return 1 if calls["n"] == 1 else 0

    monkeypatch.setattr(runner_mod, "CaptureForwarder", FakeForwarder)
    stop = asyncio.Event()
    task = asyncio.create_task(runner_mod._capture_loop(_cfg(), FakeApi(), stop))
    for _ in range(200):
        if calls["n"] >= 3:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, timeout=2)
    assert calls["n"] >= 3  # loop survived the exception and kept polling


# --------------------------------------------------------------- run_forever --
@pytest.mark.asyncio
async def test_run_forever_executes_claims_concurrently_and_shuts_down(monkeypatch):
    """Two queued runs must overlap (max_concurrency=2), then SIGTERM exits
    cleanly, closing the API client."""
    api_holder = {}

    def make_api(cfg):
        api = FakeApi(runs=[
            {"id": "r1", "steps": [], "project_path": "/tmp"},
            {"id": "r2", "steps": [], "project_path": "/tmp"},
        ])
        api_holder["api"] = api
        return api

    state = {"active": 0, "max_active": 0, "done": 0}

    async def fake_execute_run(cfg, api, run, cancel_event):
        state["active"] += 1
        state["max_active"] = max(state["max_active"], state["active"])
        await asyncio.sleep(0.05)
        state["active"] -= 1
        state["done"] += 1

    monkeypatch.setattr(runner_mod, "RunnerApi", make_api)
    monkeypatch.setattr(runner_mod, "execute_run", fake_execute_run)

    async def stop_when_done():
        for _ in range(400):
            if state["done"] >= 2:
                break
            await asyncio.sleep(0.01)
        os.kill(os.getpid(), signal.SIGTERM)

    stopper = asyncio.create_task(stop_when_done())
    await asyncio.wait_for(runner_mod.run_forever(_cfg()), timeout=5)
    await stopper

    assert state["done"] == 2
    assert state["max_active"] == 2  # both runs were in flight at the same time
    assert api_holder["api"].closed is True


@pytest.mark.asyncio
async def test_run_forever_reports_runner_error_as_failed_run(monkeypatch):
    api_holder = {}

    def make_api(cfg):
        api = FakeApi(runs=[{"id": "boom", "steps": [], "project_path": "/tmp"}])
        api_holder["api"] = api
        return api

    async def exploding_execute(cfg, api, run, cancel_event):
        raise RuntimeError("kaputt")

    monkeypatch.setattr(runner_mod, "RunnerApi", make_api)
    monkeypatch.setattr(runner_mod, "execute_run", exploding_execute)

    async def stop_soon():
        for _ in range(400):
            if api_holder.get("api") and api_holder["api"].results:
                break
            await asyncio.sleep(0.01)
        os.kill(os.getpid(), signal.SIGTERM)

    stopper = asyncio.create_task(stop_soon())
    await asyncio.wait_for(runner_mod.run_forever(_cfg()), timeout=5)
    await stopper

    (run_id, status, error) = api_holder["api"].results[0]
    assert run_id == "boom" and status == "failed" and "kaputt" in error


@pytest.mark.asyncio
async def test_heartbeat_loop_sets_cancel_event(monkeypatch):
    api = FakeApi()
    api.cancel_on_heartbeat = True
    cancel = asyncio.Event()
    stop = asyncio.Event()
    task = asyncio.create_task(
        runner_mod._heartbeat_loop(_cfg(), api, "r1", cancel, stop)
    )
    await asyncio.wait_for(cancel.wait(), timeout=2)
    stop.set()
    await asyncio.wait_for(task, timeout=2)
    assert api.heartbeats  # at least one heartbeat happened
