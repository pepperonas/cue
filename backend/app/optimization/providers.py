"""Optimizer providers (strategy registry).

The rest of the application never names a concrete backend: it asks for a
provider id, gets a `ProviderSpec`, and hands the id to whoever executes the
work. Today that is the Mac runner driving the Claude Code CLI; adding an
OpenAI / Gemini / Ollama optimizer later means one entry here plus a matching
strategy in the executing process — no changes in services, routers or UI.

`executed_by` says WHERE a provider runs, and it is what keeps the two paths
from stealing each other's work:
  * "runner"  — the job is queued and a claiming runner performs it (the CLI
                lives on the owner's Mac, not on the server). `claim()` filters
                on `runner_ids()`, so the Mac never picks up an API-key job.
  * "server"  — the in-process executor performs it inside the container
                (`optimization/server_executor.py`), an HTTPS call against the
                Messages API paid for by the user's own key.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    executed_by: str = "runner"
    # Optional model hint passed to the executor; empty = provider default.
    default_model: str = ""
    available: bool = True


CLAUDE_CLI = ProviderSpec(
    id="claude_cli",
    label="Claude Code CLI",
    description="Lokale Claude-Code-CLI auf dem Runner-Mac (claude -p)",
    executed_by="runner",
)

ANTHROPIC_API = ProviderSpec(
    id="anthropic_api",
    label="Anthropic API (eigener Key)",
    description="Messages API mit dem eigenen API-Key des Nutzers, direkt vom Server",
    executed_by="server",
)

# Future backends register here; `available=False` keeps them visible in the
# config endpoint (so the UI can show what is planned) without being selectable.
_REGISTRY: dict[str, ProviderSpec] = {
    CLAUDE_CLI.id: CLAUDE_CLI,
    ANTHROPIC_API.id: ANTHROPIC_API,
}

DEFAULT_PROVIDER = CLAUDE_CLI.id


def get(provider_id: str | None) -> ProviderSpec:
    """Resolve a provider id, falling back to the default for unknown values."""
    return _REGISTRY.get(provider_id or "", _REGISTRY[DEFAULT_PROVIDER])


def is_known(provider_id: str) -> bool:
    return provider_id in _REGISTRY


def available() -> list[ProviderSpec]:
    return [spec for spec in _REGISTRY.values() if spec.available]


def register(spec: ProviderSpec) -> None:
    """Add a provider (used by tests and future backends)."""
    _REGISTRY[spec.id] = spec


def runner_ids() -> list[str]:
    """Providers a claiming runner may execute.

    The claim query filters on this: a job for a server-side provider must
    never be handed to the Mac runner, which would try to drive the CLI for a
    job that was queued to run against somebody's API key.
    """
    return [spec.id for spec in _REGISTRY.values() if spec.executed_by == "runner"]


def server_ids() -> list[str]:
    """Providers the backend executes itself, in `optimization/server_executor`."""
    return [spec.id for spec in _REGISTRY.values() if spec.executed_by == "server"]
