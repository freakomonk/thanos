from __future__ import annotations

import json
from dataclasses import dataclass, field
from importlib import resources
from typing import Optional


@dataclass(frozen=True)
class PriceTier:
    max_tokens: int
    input_per_m_tok: float
    output_per_m_tok: float


@dataclass(frozen=True)
class CacheRates:
    write_per_m_tok: float = 0.0
    read_per_m_tok: float = 0.0


@dataclass(frozen=True)
class ModelProfile:
    model_id: str
    context_window: int
    tiers: list[PriceTier]
    provider: Optional[str] = None
    cache: CacheRates = field(default_factory=CacheRates)

    def tier_for(self, tokens: int) -> PriceTier:
        for tier in self.tiers:
            if tokens <= tier.max_tokens:
                return tier
        return self.tiers[-1]

    def estimate_cost_usd(
        self,
        total_input_tokens: int,
        output_tokens: int = 0,
        cache_write_tokens: int = 0,
        cache_read_tokens: int = 0,
    ) -> float:
        """Estimate cost for one request.

        `total_input_tokens` is the full prompt size (it decides which
        pricing tier applies); `cache_write_tokens`/`cache_read_tokens` are
        the portions of it billed at cache rates instead of the tier's
        input rate, and must be <= total_input_tokens.
        """
        tier = self.tier_for(total_input_tokens)
        fresh_tokens = max(0, total_input_tokens - cache_write_tokens - cache_read_tokens)
        cost = (fresh_tokens / 1_000_000) * tier.input_per_m_tok
        cost += (output_tokens / 1_000_000) * tier.output_per_m_tok
        cost += (cache_write_tokens / 1_000_000) * self.cache.write_per_m_tok
        cost += (cache_read_tokens / 1_000_000) * self.cache.read_per_m_tok
        return cost


def _parse_model(model_id: str, raw: dict) -> ModelProfile:
    tiers = [
        PriceTier(
            max_tokens=t["maxTokens"],
            input_per_m_tok=t["inputPerMTok"],
            output_per_m_tok=t["outputPerMTok"],
        )
        for t in raw["tiers"]
    ]
    cache_raw = raw.get("cache") or {}
    cache = CacheRates(
        write_per_m_tok=cache_raw.get("writePerMTok", 0.0),
        read_per_m_tok=cache_raw.get("readPerMTok", 0.0),
    )
    return ModelProfile(
        model_id=model_id,
        context_window=raw["contextWindow"],
        tiers=tiers,
        provider=raw.get("provider"),
        cache=cache,
    )


def load_models(extra: Optional[dict] = None) -> dict[str, ModelProfile]:
    """Load the bundled model registry, optionally merged with/overridden by `extra`.

    `extra` uses the same shape as a `models.json` "models" block, e.g.
    {"my-model": {"contextWindow": 128000, "tiers": [...], "cache": {...}}}.
    """
    raw_text = resources.files("thanos").joinpath("data", "models.json").read_text()
    data = json.loads(raw_text)
    models = {mid: _parse_model(mid, raw) for mid, raw in data["models"].items()}
    if extra:
        for mid, raw in extra.items():
            models[mid] = _parse_model(mid, raw)
    return models


def resolve_model(model: str | ModelProfile, extra: Optional[dict] = None) -> ModelProfile:
    if isinstance(model, ModelProfile):
        return model
    models = load_models(extra)
    if model not in models:
        raise KeyError(
            f"Unknown model id '{model}'. Pass a ModelProfile directly, or add it via "
            f"the `models` option, e.g. ContextGuard(model='{model}', models={{'{model}': {{...}}}})."
        )
    return models[model]
