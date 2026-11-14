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


def tiktoken_tokenizer(
    model: str = "gpt-5", encoding_name: str | None = None
) -> Tokenizer:
    """Build a `Tokenizer` backed by `tiktoken`, for exact (or
    near-exact) counts on OpenAI-family models. Not Claude's tokenizer —
    that isn't public; use `anthropic_count_tokens_tokenizer` for that.

    Requires `pip install tiktoken` (or `pip install thanos-ctx[exact]`)
    — not a dependency of `thanos` itself, so this raises a clear error
    if it's missing rather than forcing the install on everyone.
    """
    try:
        import tiktoken
    except ImportError as exc:
        raise ImportError(
            "tiktoken_tokenizer requires the `tiktoken` package. Install it with "
            "`pip install tiktoken` or `pip install thanos-ctx[exact]`."
        ) from exc

    if encoding_name is not None:
        encoding = tiktoken.get_encoding(encoding_name)
    else:
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("o200k_base")

    def tokenizer(messages: list[Message]) -> int:
        total = 0
        for message in messages:
            total += len(encoding.encode(_message_text(message)))
            total += 4  # role + message formatting overhead, same as estimate_tokens
        return total

    return tokenizer


def anthropic_count_tokens_tokenizer(client: Any, model: str) -> Tokenizer:
    """Build a `Tokenizer` that calls Anthropic's `count_tokens`
    endpoint for an exact count — a real network call, unlike the
    default offline estimate.

    `client` is your own already-configured `anthropic.Anthropic()`
    instance; thanos never creates one or touches your API key. If the
    first message has role "system", it's passed as Anthropic's
    separate `system` parameter, matching `client.messages.create()`.
    """

    def tokenizer(messages: list[Message]) -> int:
        system = None
        rest = messages
        if messages and messages[0].get("role") == "system":
            system = messages[0].get("content")
            rest = messages[1:]
        kwargs: dict[str, Any] = {"model": model, "messages": rest}
        if system is not None:
            kwargs["system"] = system
        response = client.messages.count_tokens(**kwargs)
        return response.input_tokens

    return tokenizer
