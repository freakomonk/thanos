from thanos import TruncateCompressor, estimate_tokens


def _msg(role: str, text: str) -> dict:
    return {"role": role, "content": text}


def test_truncate_keeps_pinned_prefix_untouched():
    messages = [
        _msg("system", "You are a helpful assistant. " * 5),
        _msg("user", "turn 1 " * 50),
        _msg("assistant", "turn 1 reply " * 50),
        _msg("user", "turn 2 " * 50),
        _msg("assistant", "turn 2 reply " * 50),
        _msg("user", "most recent turn " * 5),
    ]
    compressor = TruncateCompressor()
    target = estimate_tokens([messages[0], messages[-1]]) + 5

    result = compressor(messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens)

    assert result[0] == messages[0]
    assert estimate_tokens(result) <= target or len(result) == 1


def test_truncate_drops_oldest_turns_first():
    messages = [
        _msg("system", "sys"),
        _msg("user", "oldest"),
        _msg("assistant", "oldest reply"),
        _msg("user", "newest"),
    ]
    compressor = TruncateCompressor()
    # Target fits system + only the very last message.
    target = estimate_tokens([messages[0], messages[-1]])

    result = compressor(messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens)

    assert result[0]["role"] == "system"
    assert result[-1] == messages[-1]
    assert messages[1] not in result


def test_truncate_never_touches_pinned_prefix_even_if_oversized():
    messages = [_msg("system", "x" * 10_000), _msg("user", "hi")]
    compressor = TruncateCompressor()

    result = compressor(messages, target_tokens=1, pinned_prefix_len=1, tokenizer=estimate_tokens)

    assert result == [messages[0]]
