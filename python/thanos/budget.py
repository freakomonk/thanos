from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class Budget:
    """Cumulative ceiling for a conversation/session.

    Either limit is optional; set only the one(s) you care about.
    `used_tokens`/`used_cost_usd` are running totals that `ContextGuard`
    updates after each `prepare()` call when you pass `record=True`.
    """

    max_tokens: Optional[int] = None
    max_cost_usd: Optional[float] = None
    used_tokens: int = 0
    used_cost_usd: float = 0.0

    def record(self, tokens: int, cost_usd: float) -> None:
        self.used_tokens += tokens
        self.used_cost_usd += cost_usd

    def exceeded(self) -> bool:
        if self.max_tokens is not None and self.used_tokens > self.max_tokens:
            return True
        if self.max_cost_usd is not None and self.used_cost_usd > self.max_cost_usd:
            return True
        return False

    def remaining_tokens(self, fallback: int) -> int:
        if self.max_tokens is None:
            return fallback
        return max(0, self.max_tokens - self.used_tokens)
