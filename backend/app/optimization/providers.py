"""Optimizer providers (strategy registry).

The rest of the application never names a concrete backend: it asks for a
provider id, gets a `ProviderSpec`, and hands the id to whoever executes the
work. Today that is the Mac runner driving the Claude Code CLI; adding an
OpenAI / Gemini / Ollama optimizer later means one entry here plus a matching
strategy in the executing process — no changes in services, routers or UI.

`executed_by` says WHERE a provider runs:
  * "runner"  — the job is queued and a claiming runner performs it (the CLI
                lives on the owner's Mac, not on the server).
  * "server"  — reserved for future in-process providers (HTTP APIs); the
                service layer already keys off this flag.
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

# Future backends register here; `available=False` keeps them visible in the
# config endpoint (so the UI can show what is planned) without being selectable.
_REGISTRY: dict[str, ProviderSpec] = {
    CLAUDE_CLI.id: CLAUDE_CLI,
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
