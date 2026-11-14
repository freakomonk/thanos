# thanos (Python)

Keep an LLM conversation inside its context window and pricing tier, track
spend, and compress history automatically when a limit is hit.

```bash
pip install thanos-ctx
```

(Published as `thanos-ctx` — the bare `thanos` name on PyPI belongs to an
unrelated project. The import stays `from thanos import ...`.)

```python
from thanos import ContextGuard

guard = ContextGuard(model="claude-sonnet-4-5")

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "..."},
    # ... growing conversation history
]

result = guard.prepare(messages)

# Send result.messages to the API instead of the original list.
response = client.messages.create(model="claude-sonnet-4-5", messages=result.messages, ...)

print(result.tokens, result.estimated_cost_usd, result.compressed)
```

## Budgets

```python
from thanos import Budget, ContextGuard

budget = Budget(max_cost_usd=5.00)
guard = ContextGuard(model="claude-sonnet-4-5", budget=budget)

for turn in conversation:
    result = guard.prepare(turn.messages)  # auto-compresses once max_cost_usd is projected to be exceeded
```

`prepare()` records an *estimate* before you've sent the request. Once
the real response comes back, reconcile the budget with what you were
actually billed:

```python
response = client.messages.create(model="claude-sonnet-4-5", messages=result.messages, max_tokens=1024)

guard.record_actual(
    result,
    input_tokens=response.usage.input_tokens,
    output_tokens=response.usage.output_tokens,
    cache_read_tokens=response.usage.cache_read_input_tokens,
)
```

This adjusts `budget.used_tokens`/`used_cost_usd` by the delta between
the real numbers and the original estimate, so the running total tracks
actual spend rather than compounding estimation error over a long
session. Safe to call even with no `Budget` attached — it just returns
the real cost.

## Compression strategies

The default `TruncateCompressor` drops the oldest non-pinned turns.
Two more ship built in:

```python
from thanos import ContextGuard, PriorityTruncateCompressor

# Keeps tool-call/tool-result turns longer than ordinary chat turns when
# something has to be dropped.
guard = ContextGuard(model="claude-sonnet-4-5", compressor=PriorityTruncateCompressor())
```

```python
from thanos import ContextGuard, make_summarizing_compressor

def summarize(dropped_messages: list[dict]) -> str:
    # Your own call to an LLM (or anything else) — thanos never calls a
    # model itself. Return a short summary of `dropped_messages`.
    ...

guard = ContextGuard(
    model="claude-sonnet-4-5",
    compressor=make_summarizing_compressor(summarize, keep_recent=4),
)
```

`make_summarizing_compressor` keeps the pinned prefix and the last
`keep_recent` messages verbatim, and replaces everything else with one
condensed system message — so compression loses a summary's worth of
detail instead of the turns outright. Falls back to truncation (or a
`fallback=` compressor you supply) if there's nothing worth summarizing,
or the summary itself still doesn't fit.

You can of course write your own instead:

```python
from thanos import ContextGuard

def my_compressor(messages, target_tokens, pinned_prefix_len, tokenizer):
    # Your own strategy.
    ...

guard = ContextGuard(model="claude-sonnet-4-5", compressor=my_compressor)
```

## Reacting to limits

```python
def alert(info: dict) -> None:
    print(f"compressed={info['compressed']} tokens={info['tokens']} cost=${info['estimated_cost_usd']:.4f}")

guard = ContextGuard(model="claude-sonnet-4-5", on_limit=alert)
```

Pass `raise_on_limit=True` to raise `thanos.LimitExceeded` instead of just
notifying `on_limit`.

## Exact token counts

The default `estimate_tokens` is a fast, offline ~4-chars-per-token
heuristic. For exact counts:

```python
from thanos import ContextGuard, tiktoken_tokenizer

# OpenAI-family models — local, no network call. Requires
# `pip install tiktoken` or `pip install thanos-ctx[exact]`.
guard = ContextGuard(model="gpt-5", tokenizer=tiktoken_tokenizer("gpt-5"))
```

```python
import anthropic
from thanos import ContextGuard, anthropic_count_tokens_tokenizer

# Claude models — calls Anthropic's count_tokens endpoint, a real
# network request. `client` is your own, already-configured instance;
# thanos never creates one or touches your API key.
client = anthropic.Anthropic()
guard = ContextGuard(
    model="claude-sonnet-4-5",
    tokenizer=anthropic_count_tokens_tokenizer(client, model="claude-sonnet-4-5"),
)
```

(There's no JS equivalent of the Anthropic exact tokenizer — see the
[JS README](../js/README.md#exact-token-counts) for why, and the
workaround.)

## Adding or overriding a model

```python
guard = ContextGuard(
    model="my-self-hosted-model",
    models={
        "my-self-hosted-model": {
            "contextWindow": 128_000,
            "tiers": [{"maxTokens": 128_000, "inputPerMTok": 0.0, "outputPerMTok": 0.0}],
        }
    },
)
```

See the [top-level README](../README.md) for the full design rationale.
