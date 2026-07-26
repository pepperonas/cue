"""AI prompt optimization.

Layering (nothing skips a level):

    routers/optimize.py   HTTP only — auth, validation, serialization
    service.py            business rules, versioning, batches, logging
    repository.py         persistence
    providers.py          which optimizer backends exist (strategy registry)
    meta_prompt.py        the single definition of HOW a prompt is improved

The actual CLI subprocess runs in the cue-runner (`cue_runner/optimize/`) on
the machine where Claude Code is installed — the server only ever hands out a
provider id plus a fully built prompt.
"""
from .providers import DEFAULT_PROVIDER, ProviderSpec, available, get, is_known
from .service import (
    ClaimedJob,
    ExecutionResult,
    OptimizationError,
    PromptOptimizationService,
)

__all__ = [
    "ClaimedJob",
    "DEFAULT_PROVIDER",
    "ExecutionResult",
    "OptimizationError",
    "PromptOptimizationService",
    "ProviderSpec",
    "available",
    "get",
    "is_known",
]
