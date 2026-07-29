"""Runner side of long polling: ask the server to hold the request open, and
treat the poll interval as a floor on the cycle rather than a fixed sleep."""
from __future__ import annotations

import httpx

from cue_runner.api import RunnerApi
from cue_runner.config import Config
from cue_runner.runner import cycle_delay


def _cfg(**overrides) -> Config:
    base = dict(
        api_url="https://cue.example",
        runner_token="runner-secret",
        allowed_bases=["/Users/martin/claude"],
        runner_id="test-runner",
    )
    base.update(overrides)
    return Config(**base)


def _api(cfg: Config) -> tuple[RunnerApi, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    api = RunnerApi(cfg)
    api.client = httpx.AsyncClient(
        base_url=cfg.api_url,
        headers={"Authorization": f"Bearer {cfg.runner_token}"},
        transport=httpx.MockTransport(handler),
    )
    return api, requests


# ------------------------------------------------------------- cycle pacing


def test_interval_is_a_floor_not_a_fixed_sleep():
    # Server answered at once (long polling off, or a backend that ignores
    # `wait`) -> wait out the rest of the interval, i.e. the old behaviour.
    assert cycle_delay(5.0, 0.0) == 5.0
    assert cycle_delay(5.0, 1.5) == 3.5
    # The long poll already consumed the window -> go straight back in, so one
    # request covers the whole idle period instead of one every few seconds.
    assert cycle_delay(5.0, 25.0) == 0.0
    assert cycle_delay(5.0, 5.0) == 0.0
    # Never negative (a delay < 0 would raise in asyncio.wait_for).
    assert cycle_delay(1.5, 99.0) == 0.0


# ------------------------------------------------------------ wire behaviour


async def test_every_claim_asks_the_server_to_wait():
    cfg = _cfg(long_poll_wait=25.0)
    api, requests = _api(cfg)

    assert await api.claim() is None
    assert await api.claim_delivery() is None
    assert await api.claim_optimization() is None

    assert [r.url.params.get("wait") for r in requests] == ["25.0"] * 3
    assert [r.url.path for r in requests] == [
        "/api/runs/claim",
        "/api/cli/claim",
        "/api/optimizations/claim",
    ]


async def test_disabling_long_poll_omits_the_param():
    """0 must fall back to plain polling, not send `wait=0.0`."""
    cfg = _cfg(long_poll_wait=0.0)
    api, requests = _api(cfg)

    await api.claim()
    await api.claim_delivery()
    await api.claim_optimization()

    assert all("wait" not in r.url.params for r in requests)


async def test_a_parked_claim_gives_up_as_soon_as_shutdown_is_requested():
    """SIGTERM must not wait out a 25 s long poll.

    PM2 hard-kills 1.6 s after SIGTERM, so a main loop that only noticed the
    stop once its request returned would lose the graceful pass that cancels
    in-flight runs and lets them report their outcome.
    """
    import asyncio
    import time

    from cue_runner.runner import until_stopped

    stop = asyncio.Event()

    async def parked_claim():
        await asyncio.sleep(25)  # a long poll the server is holding open
        return {"id": "never"}

    async def request_stop():
        await asyncio.sleep(0.05)
        stop.set()

    started = time.monotonic()
    result, _ = await asyncio.gather(until_stopped(parked_claim(), stop), request_stop())
    elapsed = time.monotonic() - started

    assert result is None, "must not report work it never claimed"
    assert elapsed < 1.0, f"took {elapsed:.1f}s to notice the shutdown"


async def test_a_claim_that_finishes_first_still_wins():
    """The stop race must not swallow a run that was genuinely handed out."""
    import asyncio

    from cue_runner.runner import until_stopped

    async def quick_claim():
        return {"id": "r1"}

    assert await until_stopped(quick_claim(), asyncio.Event()) == {"id": "r1"}


def test_http_timeout_outlasts_the_long_poll_budget():
    """Otherwise the client aborts the very request it asked to be held open."""
    api = RunnerApi(_cfg(long_poll_wait=25.0))
    assert api.client.timeout.read > 25.0

    # A generous budget must still raise the timeout above it.
    generous = RunnerApi(_cfg(long_poll_wait=55.0))
    assert generous.client.timeout.read > 55.0

    # With long polling off the old 30 s default stands.
    assert RunnerApi(_cfg(long_poll_wait=0.0)).client.timeout.read == 30.0
