"""Async HTTP client for the cue runner endpoints (Bearer RUNNER_TOKEN)."""
from __future__ import annotations

import asyncio
import logging

import httpx

from .config import Config

log = logging.getLogger("cue-runner.api")

# A finished optimization is the most expensive thing this process carries: it
# cost CLI time and real money, and it exists nowhere else. Losing the report
# because the server happened to be restarting would throw all of that away, so
# the delivery is retried before it is given up on.
_RESULT_ATTEMPTS = 3
_RESULT_BACKOFF_S = 2.0


class RunnerApi:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.client = httpx.AsyncClient(
            base_url=cfg.api_url,
            headers={"Authorization": f"Bearer {cfg.runner_token}"},
            # Must outlast a long-polled claim, or the client would abort the
            # very request it asked the server to hold open.
            timeout=max(30.0, cfg.long_poll_wait + 15.0),
        )

    @property
    def _wait(self) -> dict[str, float]:
        """Long-poll budget as a query param (omitted when disabled)."""
        return {"wait": self.cfg.long_poll_wait} if self.cfg.long_poll_wait > 0 else {}

    async def aclose(self) -> None:
        await self.client.aclose()

    async def claim(self) -> dict | None:
        r = await self.client.post(
            "/api/runs/claim", json={"runner_id": self.cfg.runner_id}, params=self._wait
        )
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
        r = await self.client.get("/api/cli/claim", params=self._wait)
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    async def delivery_result(self, delivery_id: int, status: str, error: str | None = None) -> None:
        await self.client.post(
            f"/api/cli/{delivery_id}/result",
            json={"status": status, "error": error},
        )

    async def claim_optimization(self) -> dict | None:
        r = await self.client.post(
            "/api/optimizations/claim",
            json={"runner_id": self.cfg.runner_id},
            params=self._wait,
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    async def optimization_result(
        self,
        optimization_id: int,
        *,
        status: str,
        optimized_text: str | None = None,
        model: str = "",
        exit_code: int | None = None,
        duration_ms: int | None = None,
        cost_usd: float | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        error: str | None = None,
    ) -> None:
        """Report an outcome, retrying a transient failure.

        This used to be fire-and-forget: no `raise_for_status`, no logging. A
        refused report therefore vanished without a trace on EITHER side — seen
        in production as `POST /api/optimizations/11/result -> 404` after the
        prompt had been deleted mid-run, with nothing anywhere saying that a
        finished optimization had been discarded.
        """
        payload = {
            "status": status,
            "optimized_text": optimized_text,
            "model": model,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "cost_usd": cost_usd,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "error": error,
        }
        await self._post_result(
            art="optimization",
            ident=optimization_id,
            path=f"/api/optimizations/{optimization_id}/result",
            payload=payload,
            cost_usd=cost_usd,
        )

    async def claim_analysis(self) -> dict | None:
        """Den nächsten Projekt-Analyse-Job übernehmen (None = nichts zu tun)."""
        r = await self.client.post(
            "/api/analyses/claim",
            json={"runner_id": self.cfg.runner_id},
            params=self._wait,
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    async def analysis_result(
        self,
        analysis_id: int,
        *,
        status: str,
        optimized_text: str | None = None,
        model: str = "",
        exit_code: int | None = None,
        duration_ms: int | None = None,
        cost_usd: float | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        error: str | None = None,
    ) -> None:
        """Ergebnis einer Analyse melden — gleiche Meldepolitik wie oben.

        Das Feld heißt weiterhin `optimized_text`: der Ausführer liefert in
        beiden Fällen Text plus Telemetrie und kennt dessen Bedeutung nicht.
        Ein zweites, feldgleiches Schema wäre nur eine weitere Stelle zum
        Driften.
        """
        await self._post_result(
            art="analysis",
            ident=analysis_id,
            path=f"/api/analyses/{analysis_id}/result",
            payload={
                "status": status,
                "optimized_text": optimized_text,
                "model": model,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "cost_usd": cost_usd,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "error": error,
            },
            cost_usd=cost_usd,
        )

    async def _post_result(
        self, *, art: str, ident: int, path: str, payload: dict, cost_usd: float | None
    ) -> None:
        """Ein Ergebnis melden und einen vorübergehenden Fehler wiederholen.

        EINE Meldepolitik für beide Job-Arten. Früher war das fire-and-forget:
        kein `raise_for_status`, kein Log — ein abgewiesener Bericht verschwand
        spurlos auf BEIDEN Seiten (real gesehen als `-> 404`, nachdem der
        Prompt mitten im Lauf gelöscht worden war).
        """
        for attempt in range(1, _RESULT_ATTEMPTS + 1):
            try:
                r = await self.client.post(path, json=payload)
            except httpx.HTTPError as exc:
                if attempt == _RESULT_ATTEMPTS:
                    log.error(
                        "%s %s: result LOST after %s attempts (%s)%s",
                        art,
                        ident,
                        attempt,
                        exc,
                        self._cost_note(cost_usd),
                    )
                    return
                await asyncio.sleep(_RESULT_BACKOFF_S * attempt)
                continue

            if r.status_code < 300:
                return
            if r.status_code < 500:
                # Der Job ist weg oder nimmt kein Ergebnis mehr an — meist
                # wurde sein Gegenstand gelöscht, während der Ausführer lief.
                # Endgültig: ein Wiederholen bringt die Zeile nicht zurück.
                log.warning(
                    "%s %s: result discarded by the server (HTTP %s)%s",
                    art,
                    ident,
                    r.status_code,
                    self._cost_note(cost_usd),
                )
                return
            if attempt == _RESULT_ATTEMPTS:
                log.error(
                    "%s %s: result LOST after %s attempts (HTTP %s)%s",
                    art,
                    ident,
                    attempt,
                    r.status_code,
                    self._cost_note(cost_usd),
                )
                return
            await asyncio.sleep(_RESULT_BACKOFF_S * attempt)

    @staticmethod
    def _cost_note(cost_usd: float | None) -> str:
        return f" — {cost_usd:.2f} USD" if cost_usd else ""

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
