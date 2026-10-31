from __future__ import annotations

from typing import Any, Protocol

from .tokenizer import Tokenizer, estimate_tokens

Message = dict[str, Any]


class Compressor(Protocol):
    def __call__(
        self,
        messages: list[Message],
        target_tokens: int,
        pinned_prefix_len: int,
        tokenizer: Tokenizer,
    ) -> list[Message]: ...


class TruncateCompressor:
    """Default, zero-dependency compressor.

    Keeps `messages[:pinned_prefix_len]` (the system message and anything
    before the provider's cache breakpoint) untouched, then drops the
    oldest remaining messages until the result fits `target_tokens`.
    Never reorders or edits a message, so it never busts a cache
    breakpoint that falls inside the pinned prefix.
    """

    def __call__(
        self,
        messages: list[Message],
        target_tokens: int,
        pinned_prefix_len: int,
        tokenizer: Tokenizer = estimate_tokens,
    ) -> list[Message]:
        pinned = messages[:pinned_prefix_len]
        rest = messages[pinned_prefix_len:]

        if tokenizer(pinned) >= target_tokens:
            # Even the pinned prefix alone doesn't fit; nothing safe to drop.
            return pinned

        kept: list[Message] = []
        for message in reversed(rest):
            candidate = [message] + kept
            if tokenizer(pinned + candidate) > target_tokens:
                break
            kept = candidate
        return pinned + kept
