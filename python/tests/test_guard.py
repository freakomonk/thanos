from thanos import Budget, ContextGuard


def _msg(role: str, text: str) -> dict:
    return {"role": role, "content": text}


def test_prepare_returns_stats_without_compression_when_under_limit():
    guard = ContextGuard(model="claude-haiku-4-5")
    messages = [_msg("user", "hello there")]

    result = guard.prepare(messages)

    assert result.compressed is False
    assert result.limit_exceeded is False
    assert result.tokens > 0
    assert result.messages == messages


def test_prepare_compresses_when_over_tier_ceiling():
    guard = ContextGuard(model="claude-haiku-4-5", stay_in_tier=0)
    big_history = [_msg("system", "sys")] + [
        _msg("user", "x" * 4000) for _ in range(300)
    ]

    result = guard.prepare(big_history)

    assert result.compressed is True
    assert len(result.messages) < len(big_history)
    assert result.messages[0]["role"] == "system"


def test_on_limit_callback_fires_and_does_not_raise_by_default():
    calls = []
    guard = ContextGuard(
        model="claude-haiku-4-5",
        stay_in_tier=0,
        on_limit=lambda info: calls.append(info),
    )
    big_history = [_msg("system", "sys")] + [
        _msg("user", "x" * 4000) for _ in range(300)
    ]

    guard.prepare(big_history)

    assert len(calls) == 1
    assert calls[0]["compressed"] is True


def test_budget_ceiling_triggers_limit_and_raise_on_limit_raises():
    from thanos import LimitExceeded

    budget = Budget(max_tokens=50)
    guard = ContextGuard(model="claude-haiku-4-5", budget=budget, raise_on_limit=True)
    messages = [_msg("user", "x" * 4000)]  # far more than 50 tokens

    try:
        guard.prepare(messages)
        assert False, "expected LimitExceeded"
    except LimitExceeded:
        pass


def test_custom_tokenizer_and_compressor_are_used():
    from thanos.pricing import ModelProfile, PriceTier

    calls = {"tokenizer": 0, "compressor": 0}

    def fixed_tokenizer(messages):
        calls["tokenizer"] += 1
        return 10

    def noop_compressor(messages, target_tokens, pinned_prefix_len, tokenizer):
        calls["compressor"] += 1
        return messages

    tiny_model = ModelProfile(
        model_id="tiny",
        context_window=5,
        tiers=[PriceTier(max_tokens=5, input_per_m_tok=1.0, output_per_m_tok=1.0)],
    )
    guard = ContextGuard(
        model=tiny_model,
        tokenizer=fixed_tokenizer,
        compressor=noop_compressor,
        stay_in_tier=None,
    )

    result = guard.prepare([_msg("user", "hi")])

    assert calls["tokenizer"] >= 1
    assert calls["compressor"] == 1
    assert result.tokens == 10


def test_record_actual_corrects_budget_by_the_delta():
    budget = Budget(max_cost_usd=100.0)
    guard = ContextGuard(model="claude-haiku-4-5", budget=budget)
    result = guard.prepare([_msg("user", "hello")], estimated_output_tokens=10)

    estimated_cost = result.estimated_cost_usd
    estimated_tokens = budget.used_tokens

    actual_cost = guard.record_actual(result, input_tokens=1000, output_tokens=500)

    assert actual_cost != estimated_cost
    assert budget.used_cost_usd == estimated_cost + (actual_cost - estimated_cost)
    assert budget.used_tokens == estimated_tokens + (1500 - result.recorded_tokens)


def test_record_actual_is_a_no_op_on_budget_without_one_attached():
    guard = ContextGuard(model="claude-haiku-4-5")
    result = guard.prepare([_msg("user", "hello")])

    actual_cost = guard.record_actual(result, input_tokens=1000, output_tokens=500)

    assert actual_cost > 0  # just returns the real cost, nothing to correct


def test_record_actual_fires_on_limit_when_actual_pushes_over_budget():
    calls = []
    budget = Budget(max_cost_usd=0.001)
    guard = ContextGuard(
        model="claude-haiku-4-5",
        budget=budget,
        on_limit=lambda info: calls.append(info),
    )
    result = guard.prepare([_msg("user", "hi")], record=True)
    calls.clear()  # ignore whatever prepare() itself fired

    guard.record_actual(result, input_tokens=10_000_000, output_tokens=0)

    assert len(calls) == 1
    assert calls[0]["limit_exceeded"] is True
