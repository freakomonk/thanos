# thanos

A tiny, dependency-light utility that keeps an LLM conversation inside its
context window and pricing tier, tracks spend, and compresses history when
a limit is hit — in Python or TypeScript/JavaScript, with no SDK or
framework lock-in.

Model pricing isn't flat: cross a context-length threshold (e.g. a "long
context" tier above 200K tokens) or write/read from the prompt cache, and
the per-token rate changes. `thanos` wraps the plain message list you're
about to send, tells you which tier you're in and what it'll cost, and
compresses the history automatically if you'd otherwise cross a limit you
set — a context-window ceiling, a pricing tier, a token budget, or a
dollar budget.

```
guard = ContextGuard(model="claude-sonnet-4-5")
result = guard.prepare(messages)
# result.messages  -> compressed if needed, otherwise unchanged
# result.tokens, result.estimated_cost_usd, result.compressed
```

It never calls the model, never makes a network request, and never
mutates messages before your cache breakpoint — the default compressor
only drops the oldest *non-pinned* turns.

## Packages

- [`python/`](python/) — `pip install thanos`
- [`js/`](js/) — `npm install thanos`

Both implement the same small set of concepts:

| Concept | What it does |
|---|---|
| `ModelProfile` / model registry | Context window, pricing tiers, cache write/read rates per model. Ships Anthropic + OpenAI presets; add your own via a plain config object — no code changes. |
| `Tokenizer` | Counts tokens for a message list. Defaults to a fast offline estimate; swap in an exact provider token-count call if you want precision. |
| `Compressor` | Shrinks a message list to fit a token target. Default keeps the pinned prefix and drops the oldest turns; swap in your own (e.g. an LLM-summarization callback). |
| `Budget` | Optional cumulative token/dollar ceiling across a whole conversation, checked alongside the context-window/tier limit. |
| `ContextGuard` | Ties the above together: `prepare(messages)` → tokens, tier, estimated cost, and the (possibly compressed) messages to actually send. |

The model registry lives in [`python/thanos/data/models.json`](python/thanos/data/models.json)
(the Python package bundles it; the JS package's `npm run build` copies it
in, so there's one source of truth). **Pricing data is illustrative and
will go stale — check it against the provider's own pricing page, and feel
free to override it** via the `models` option on `ContextGuard` without
touching this repo.

## Design choices

- **No framework or SDK coupling.** `prepare()` takes and returns a plain
  list of `{role, content}` messages, so it drops into a raw SDK call, a
  LangChain chain, a hand-rolled agent loop — anything.
- **Cache-aware by default.** A `pinnedPrefixLen` marks how many leading
  messages sit before your provider's cache breakpoint; the default
  compressor never touches them, since reordering or dropping a message
  inside that prefix busts the cache and forces a full (expensive)
  cache-write on the next call.
- **Never throws by default.** Hitting a limit auto-compresses and fires an
  `onLimit`/`on_limit` callback you can log or alert on. Pass
  `raiseOnLimit`/`raise_on_limit=True` if you want a hard stop instead.
- **Everything pluggable, sane defaults free.** The tokenizer, compressor,
  and pricing table all have a zero-dependency default, but are each a
  single-method interface you can replace.

## License

MIT — see [LICENSE](LICENSE).
