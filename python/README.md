# thanos (Python)

Keep an LLM conversation inside its context window and pricing tier, track
spend, and compress history automatically when a limit is hit.

```bash
pip install thanos
```

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

## Custom compression

```python
from thanos import ContextGuard

def summarize_and_truncate(messages, target_tokens, pinned_prefix_len, tokenizer):
    # Your own strategy — e.g. call an LLM to summarize the dropped turns
    # into one system note, then fall back to truncation.
    ...

guard = ContextGuard(model="claude-sonnet-4-5", compressor=summarize_and_truncate)
```

## Reacting to limits

```python
def alert(info: dict) -> None:
    print(f"compressed={info['compressed']} tokens={info['tokens']} cost=${info['estimated_cost_usd']:.4f}")

guard = ContextGuard(model="claude-sonnet-4-5", on_limit=alert)
```

Pass `raise_on_limit=True` to raise `thanos.LimitExceeded` instead of just
notifying `on_limit`.

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
