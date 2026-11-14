from __future__ import annotations

from typing import Any, Callable, Protocol

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


def _is_tool_related(message: Message) -> bool:
    if message.get("role") == "tool":  # OpenAI-style tool result
        return True
    content = message.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") in (
                "tool_use",
                "tool_result",
            ):
                return True
    return False


class PriorityTruncateCompressor:
    """Like `TruncateCompressor`, but drops ordinary text turns before
    tool-call/tool-result turns, since a dropped tool result usually
    costs more (in lost signal, or a confused follow-up call) than a
    dropped line of chat. Still zero-dependency, still never touches the
    pinned prefix.

    Fills the budget in two passes, newest-first within each: first the
    tool-related messages, then whatever ordinary messages still fit.
    The result is re-sorted back into the original chronological order.
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
            return pinned

        indexed = list(enumerate(rest))
        important = [pair for pair in indexed if _is_tool_related(pair[1])]
        ordinary = [pair for pair in indexed if not _is_tool_related(pair[1])]

        kept_indices: set[int] = set()

        def try_add(pool: list[tuple[int, Message]]) -> None:
            for i, _message in reversed(pool):
                candidate_indices = kept_indices | {i}
                candidate = [rest[j] for j in sorted(candidate_indices)]
                if tokenizer(pinned + candidate) > target_tokens:
                    continue
                kept_indices.add(i)

        try_add(important)
        try_add(ordinary)

        kept = [rest[j] for j in sorted(kept_indices)]
        return pinned + kept


def make_summarizing_compressor(
    summarize: Callable[[list[Message]], str],
    keep_recent: int = 4,
    fallback: Compressor | None = None,
) -> Compressor:
    """Build a `Compressor` that summarizes the turns it would otherwise
    drop into one note, instead of losing them outright.

    `summarize(dropped_messages) -> str` is *your own* call to an LLM (or
    any other summarizer) — thanos never calls a model itself. Keeps the
    pinned prefix and the last `keep_recent` messages verbatim; summarizes
    everything in between into a single system message inserted right
    after the pinned prefix. Falls back to `fallback` (default
    `TruncateCompressor()`) when there's nothing worth summarizing, or
    the summary itself still doesn't fit.
    """
    fallback_compressor: Compressor = fallback or TruncateCompressor()

    def compressor(
        messages: list[Message],
        target_tokens: int,
        pinned_prefix_len: int,
        tokenizer: Tokenizer = estimate_tokens,
    ) -> list[Message]:
        pinned = messages[:pinned_prefix_len]
        rest = messages[pinned_prefix_len:]

        if tokenizer(pinned) >= target_tokens or len(rest) <= keep_recent:
            return fallback_compressor(
                messages, target_tokens, pinned_prefix_len, tokenizer
            )

        to_summarize = rest[: len(rest) - keep_recent]
        recent = rest[len(rest) - keep_recent :]
        if not to_summarize:
            return fallback_compressor(
                messages, target_tokens, pinned_prefix_len, tokenizer
            )

        summary_text = summarize(to_summarize)
        summary_message: Message = {
            "role": "system",
            "content": f"[Summary of {len(to_summarize)} earlier messages]\n{summary_text}",
        }

        candidate = pinned + [summary_message] + recent
        if tokenizer(candidate) <= target_tokens:
            return candidate

        # Summary + recent still doesn't fit — truncate that, protecting
        # the summary itself (it's position pinned_prefix_len) the same
        # way the real pinned prefix is protected.
        return fallback_compressor(
            candidate, target_tokens, pinned_prefix_len + 1, tokenizer
        )

    return compressor
