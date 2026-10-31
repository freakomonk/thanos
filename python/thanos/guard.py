from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .budget import Budget
from .compressor import Compressor, TruncateCompressor
from .pricing import ModelProfile, resolve_model
from .tokenizer import Tokenizer, estimate_tokens

Message = dict[str, Any]


class LimitExceeded(Exception):
    """Raised by `ContextGuard.prepare()` when `raise_on_limit=True` and a
    configured limit is hit (after attempting compression)."""


@dataclass
class GuardResult:
    messages: list[Message]
    tokens: int
    tier_max_tokens: int
    estimated_cost_usd: float
    compressed: bool
    limit_exceeded: bool


@dataclass
class ContextGuard:
    model: str | ModelProfile
    models: Optional[dict] = None
    budget: Optional[Budget] = None
    tokenizer: Tokenizer = field(default=estimate_tokens)
    compressor: Compressor = field(default_factory=TruncateCompressor)
    pinned_prefix_len: int = 1
    stay_in_tier: Optional[int] = 0
    raise_on_limit: bool = False
    on_limit: Optional[Callable[[dict], None]] = None

    def __post_init__(self) -> None:
        self._model: ModelProfile = resolve_model(self.model, self.models)

    def _ceiling(self) -> int:
        if self.stay_in_tier is not None:
            ceiling = self._model.tiers[self.stay_in_tier].max_tokens
        else:
            ceiling = self._model.context_window
        if self.budget is not None:
            ceiling = min(ceiling, self.budget.remaining_tokens(ceiling))
        return ceiling

    def prepare(
        self,
        messages: list[Message],
        estimated_output_tokens: int = 0,
        cache_write_tokens: int = 0,
        cache_read_tokens: int = 0,
        record: bool = True,
    ) -> GuardResult:
        ceiling = self._ceiling()
        tokens = self.tokenizer(messages)
        compressed = False

        if tokens > ceiling:
            messages = self.compressor(
                messages, ceiling, self.pinned_prefix_len, self.tokenizer
            )
            tokens = self.tokenizer(messages)
            compressed = True

        limit_exceeded = tokens > ceiling
        cost = self._model.estimate_cost_usd(
            tokens, estimated_output_tokens, cache_write_tokens, cache_read_tokens
        )

        if self.budget is not None and record:
            self.budget.record(tokens + estimated_output_tokens, cost)
            if self.budget.exceeded():
                limit_exceeded = True

        if limit_exceeded or compressed:
            info = {
                "tokens": tokens,
                "ceiling": ceiling,
                "compressed": compressed,
                "limit_exceeded": limit_exceeded,
                "estimated_cost_usd": cost,
            }
            if self.on_limit is not None:
                self.on_limit(info)
            if limit_exceeded and self.raise_on_limit:
                raise LimitExceeded(
                    f"Context guard limit exceeded for model '{self._model.model_id}': "
                    f"{tokens} tokens > ceiling of {ceiling}."
                )

        tier = self._model.tier_for(tokens)
        return GuardResult(
            messages=messages,
            tokens=tokens,
            tier_max_tokens=tier.max_tokens,
            estimated_cost_usd=cost,
            compressed=compressed,
            limit_exceeded=limit_exceeded,
        )
