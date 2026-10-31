from thanos import load_models


def test_loads_bundled_models():
    models = load_models()
    assert "claude-sonnet-4-5" in models
    sonnet = models["claude-sonnet-4-5"]
    assert sonnet.context_window == 1_000_000
    assert len(sonnet.tiers) == 2


def test_tier_for_selects_cheaper_tier_below_threshold():
    models = load_models()
    sonnet = models["claude-sonnet-4-5"]
    cheap_tier = sonnet.tier_for(100_000)
    expensive_tier = sonnet.tier_for(500_000)
    assert cheap_tier.input_per_m_tok < expensive_tier.input_per_m_tok


def test_estimate_cost_usd_bills_cache_tokens_at_cache_rate():
    models = load_models()
    haiku = models["claude-haiku-4-5"]
    # 1,000 total tokens, all served from cache read.
    cost = haiku.estimate_cost_usd(total_input_tokens=1000, cache_read_tokens=1000)
    expected = (1000 / 1_000_000) * haiku.cache.read_per_m_tok
    assert cost == expected


def test_extra_models_override_and_extend_registry():
    models = load_models(
        extra={
            "my-custom-model": {
                "contextWindow": 32000,
                "tiers": [
                    {"maxTokens": 32000, "inputPerMTok": 0.5, "outputPerMTok": 1.5}
                ],
            }
        }
    )
    assert "my-custom-model" in models
    assert models["my-custom-model"].context_window == 32000
