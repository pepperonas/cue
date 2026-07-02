"""Async HTTP client for the cue runner endpoints (Bearer RUNNER_TOKEN)."""
from __future__ import annotations

import httpx

from .config import Config


class RunnerApi:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.client = httpx.AsyncClient(
            base_url=cfg.api_url,
            headers={"Authorization": f"Bearer {cfg.runner_token}"},
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self.client.aclose()

    async def claim(self) -> dict | None:
        r = await self.client.post("/api/runs/claim", json={"runner_id": self.cfg.runner_id})
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    async def heartbeat(self, run_id: str) -> dict:
        r = await self.client.post(f"/api/runs/{run_id}/heartbeat")
        r.raise_for_status()
        return r.json()

    async def append_log(self, run_id: str, step_index: int, lines: list[tuple[str, str]]) -> None:
        await self.client.post(
            f"/api/runs/{run_id}/log",
            json={
                "step_index": step_index,
                "lines": [{"event_type": e, "line": l} for e, l in lines],
            },
        )

    async def step_result(
        self,
        run_id: str,
        idx: int,
        status: str,
        *,
        claude_session_id: str | None = None,
        output: str | None = None,
        exit_code: int | None = None,
        cost_usd: float | None = None,
    ) -> None:
        await self.client.post(
            f"/api/runs/{run_id}/steps/{idx}/result",
            json={
                "status": status,
                "claude_session_id": claude_session_id,
                "output": output,
                "exit_code": exit_code,
                "cost_usd": cost_usd,
            },
        )

    async def claim_delivery(self) -> dict | None:
        r = await self.client.get("/api/cli/claim")
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    async def delivery_result(self, delivery_id: int, status: str, error: str | None = None) -> None:
        await self.client.post(
            f"/api/cli/{delivery_id}/result",
            json={"status": status, "error": error},
        )

    async def capture(self, items: list[dict]) -> dict:
        # Capture uses its own token (not the runner token).
        r = await self.client.post(
            "/api/capture",
            json={"items": items},
            headers={"Authorization": f"Bearer {self.cfg.capture_token}"},
        )
        r.raise_for_status()
        return r.json()

    async def run_result(
        self,
        run_id: str,
        status: str,
        *,
        total_cost_usd: float | None = None,
        error: str | None = None,
    ) -> None:
        await self.client.post(
            f"/api/runs/{run_id}/result",
            json={"status": status, "total_cost_usd": total_cost_usd, "error": error},
        )
