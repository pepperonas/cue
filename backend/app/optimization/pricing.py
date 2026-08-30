"""What an Anthropic API call costs, in one place.

⚠️ Read this together with the money block at the top of `app/stats.py`. There
the argument was that cost must NOT be derived from tokens; here it must be —
and the difference is the data, not the principle:

* The Claude Code CLI reports `total_cost_usd` itself, and the token counts it
  stores are incomplete (cached input is excluded), so multiplying them by a
  price understates the input side by roughly fifty times.
* The Messages API returns a COMPLETE usage breakdown — uncached input, cache
  writes, cache reads and output — and reports no price at all. Multiplying is
  the only way to a number, and it is an exact one as long as the table below
  matches Anthropic's published rates.

So: CLI path → reported cost. API path → computed from usage with this table.
Both land in the same `PromptOptimization.cost_usd` column, and the statistics
label the total as an estimate wherever this path contributed.

Rates are US dollars per MILLION tokens, taken from Anthropic's published
pricing (state: 2026-06-24). They are a snapshot of someone else's price list,
so they can go stale — `STATE` is surfaced in the API and the settings page so
a wrong number is at least a dated one. Cache multipliers are Anthropic's:
a cache write costs 1.25× the input rate, a cache read 0.1×.
"""
from __future__ import annotations

from dataclasses import dataclass

#: When the rates below were last checked against Anthropic's price list.
STATE = "2026-06-24"

CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.1


@dataclass(frozen=True)
class ModelPrice:
    id: str
    label: str
    #: US dollars per million tokens.
    input_per_mtok: float
    output_per_mtok: float


# Only models a user should be pointed at for this job. Rewriting a prompt is
# constraint-following, not creative range, so the list spans the price scale
# rather than trying to be complete.
MODELS: tuple[ModelPrice, ...] = (
    ModelPrice("claude-opus-5", "Claude Opus 5", 5.00, 25.00),
    ModelPrice("claude-sonnet-5", "Claude Sonnet 5", 2.00, 10.00),
    ModelPrice("claude-haiku-4-5", "Claude Haiku 4.5", 1.00, 5.00),
)

DEFAULT_MODEL = MODELS[0].id

_BY_ID = {price.id: price for price in MODELS}


def get(model_id: str | None) -> ModelPrice | None:
    """The price row for a model, or None when we have no rate for it.

    None is a real answer, not a failure: a model we cannot price must produce
    "no cost recorded" rather than a made-up number.
    """
    return _BY_ID.get(model_id or "")


def is_known(model_id: str | None) -> bool:
    return (model_id or "") in _BY_ID


def cost_usd(
    model_id: str | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float | None:
    """Cost of one call, or None when the model has no known rate.

    All four token classes are billed differently, and a single optimization
    uses no caching today — the cache terms are here because leaving them out
    would make the function quietly wrong the day something adds a cached
    system prompt.
    """
    price = get(model_id)
    if price is None:
        return None
    million = 1_000_000
    total = (
        input_tokens * price.input_per_mtok
        + cache_write_tokens * price.input_per_mtok * CACHE_WRITE_MULTIPLIER
        + cache_read_tokens * price.input_per_mtok * CACHE_READ_MULTIPLIER
        + output_tokens * price.output_per_mtok
    ) / million
    # Six places: a Haiku rewrite lands near $0.0008, which four decimals would
    # round to a number that looks like a rounding error.
    return round(total, 6)
