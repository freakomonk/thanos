from thanos import (
    PriorityTruncateCompressor,
    TruncateCompressor,
    estimate_tokens,
    make_summarizing_compressor,
)


def _msg(role: str, text: str) -> dict:
    return {"role": role, "content": text}


def _tool_msg(text: str) -> dict:
    return {"role": "assistant", "content": [{"type": "tool_use", "text": text}]}


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

    result = compressor(
        messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

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

    result = compressor(
        messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert result[0]["role"] == "system"
    assert result[-1] == messages[-1]
    assert messages[1] not in result


def test_truncate_never_touches_pinned_prefix_even_if_oversized():
    messages = [_msg("system", "x" * 10_000), _msg("user", "hi")]
    compressor = TruncateCompressor()

    result = compressor(
        messages, target_tokens=1, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert result == [messages[0]]


def test_priority_truncate_keeps_tool_messages_over_ordinary_ones():
    messages = [
        _msg("system", "sys"),
        _msg("user", "ordinary chit-chat " * 20),
        _tool_msg("important tool result " * 20),
        _msg("user", "most recent " * 5),
    ]
    compressor = PriorityTruncateCompressor()
    # Big enough for system + the tool message + the most recent message,
    # but not also the ordinary chit-chat turn.
    target = estimate_tokens([messages[0], messages[2], messages[3]])

    result = compressor(
        messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert messages[2] in result
    assert messages[1] not in result


def test_priority_truncate_never_touches_pinned_prefix():
    messages = [_msg("system", "x" * 10_000), _msg("user", "hi")]
    compressor = PriorityTruncateCompressor()

    result = compressor(
        messages, target_tokens=1, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert result == [messages[0]]


def test_summarizing_compressor_replaces_dropped_history_with_summary():
    messages = [_msg("system", "sys")] + [
        _msg("user", f"turn {i} " * 10) for i in range(10)
    ]
    calls = []

    def summarize(dropped):
        calls.append(dropped)
        return "condensed history"

    compressor = make_summarizing_compressor(summarize, keep_recent=2)
    # Enough room for pinned + a short summary + the last 2 messages
    # verbatim, but well under the full, uncompressed history.
    target = estimate_tokens([messages[0]]) + estimate_tokens(messages[-2:]) + 50
    assert target < estimate_tokens(messages)  # sanity: this must force compression

    result = compressor(
        messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert len(calls) == 1
    assert len(calls[0]) == len(messages) - 1 - 2  # all but pinned + 2 recent
    assert result[0] == messages[0]
    assert "condensed history" in result[1]["content"]
    assert result[-2:] == messages[-2:]


def test_summarizing_compressor_falls_back_when_nothing_to_summarize():
    messages = [_msg("system", "sys"), _msg("user", "only one turn")]
    calls = []

    def summarize(dropped):
        calls.append(dropped)
        return "should not be called"

    compressor = make_summarizing_compressor(summarize, keep_recent=4)

    result = compressor(
        messages, target_tokens=1, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert calls == []
    assert result == [messages[0]]  # fell back to TruncateCompressor


def test_summarizing_compressor_trims_recent_while_protecting_the_summary():
    messages = [_msg("system", "sys")] + [
        _msg("user", f"turn {i} " * 30) for i in range(6)
    ]

    def summarize(dropped):
        return "condensed summary of history"

    compressor = make_summarizing_compressor(summarize, keep_recent=3)
    summary_text = "[Summary of 3 earlier messages]\ncondensed summary of history"
    summary_msg = {"role": "system", "content": summary_text}
    # Room for pinned + summary + only the single most recent message.
    target = estimate_tokens([messages[0], summary_msg, messages[-1]])

    result = compressor(
        messages, target, pinned_prefix_len=1, tokenizer=estimate_tokens
    )

    assert result[0] == messages[0]
    assert "condensed summary of history" in result[1]["content"]
    assert result[-1] == messages[-1]
    assert estimate_tokens(result) <= target
