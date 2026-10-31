from __future__ import annotations

from typing import Any, Callable, Protocol

Message = dict[str, Any]


def _message_text(message: Message) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text", block.get("content", ""))))
        return "".join(parts)
    return str(content)


def estimate_tokens(messages: list[Message]) -> int:
    """Fast, offline token estimate (no network call).

    Uses a ~4-characters-per-token heuristic plus a small per-message
    overhead for role/formatting tokens. Good enough for threshold/budget
    decisions; swap in an exact provider token-count API via the
    `tokenizer` option on `ContextGuard` if you need precision.
    """
    total = 0
    for message in messages:
        text = _message_text(message)
        total += max(1, len(text) // 4)
        total += 4  # role + message formatting overhead
    return total


class Tokenizer(Protocol):
    def __call__(self, messages: list[Message]) -> int: ...


DEFAULT_TOKENIZER: Callable[[list[Message]], int] = estimate_tokens
