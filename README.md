# thanos

[![CI](https://github.com/freakomonk/thanos/actions/workflows/ci.yml/badge.svg)](https://github.com/freakomonk/thanos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A tiny, dependency-light utility that keeps an LLM conversation inside its
context window and pricing tier, tracks spend, and compresses history when
a limit is hit — in Python or TypeScript/JavaScript, with no SDK or
framework lock-in.

```bash
pip install thanos      # or: npm install thanos
```

```python
from thanos import ContextGuard

guard = ContextGuard(model="claude-sonnet-4-5")
result = guard.prepare(messages)
# result.messages            -> compressed if needed, otherwise unchanged
# result.tokens, result.estimated_cost_usd, result.compressed
```

Model pricing isn't flat: cross a context-length threshold (e.g. a "long
context" tier above 200K tokens) or write/read from the prompt cache, and
the per-token rate changes. `thanos` wraps the plain message list you're
about to send, tells you which tier you're in and what it'll cost, and
compresses the history automatically if you'd otherwise cross a limit you
set — a context-window ceiling, a pricing tier, a token budget, or a
dollar budget. It never calls the model, never makes a network request,
and never mutates messages before your cache breakpoint — the default
compressor only drops the oldest *non-pinned* turns.

## Packages

- [`python/`](python/) — `pip install thanos` — full usage docs, custom compressors, budgets
- [`js/`](js/) — `npm install thanos` — full usage docs, custom compressors, budgets

Both implement the same small set of concepts:

| Concept | What it does |
|---|---|
| `ModelProfile` / model registry | Context window, pricing tiers, cache write/read rates per model. Ships Anthropic + OpenAI presets; add your own via a plain config object — no code changes. |
| `Tokenizer` | Counts tokens for a message list. Defaults to a fast offline estimate; swap in an exact provider token-count call if you want precision. |
| `Compressor` | Shrinks a message list to fit a token target. Default keeps the pinned prefix and drops the oldest turns; swap in your own (e.g. an LLM-summarization callback). |
| `Budget` | Optional cumulative token/dollar ceiling across a whole conversation, checked alongside the context-window/tier limit. |
| `ContextGuard` | Ties the above together: `prepare(messages)` → tokens, tier, estimated cost, and the (possibly compressed) messages to actually send. |

## Supported models

Source of truth: [`python/thanos/data/models.json`](python/thanos/data/models.json)
— the Python package bundles it directly; the JS package's `npm run build`
copies it in via `js/scripts/sync-pricing.mjs`, so there is exactly one
file to edit. The table below is generated from it by
[`scripts/generate-model-table.mjs`](scripts/generate-model-table.mjs); CI
fails if they drift apart (see the `docs` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Run
`node scripts/generate-model-table.mjs` after editing `models.json`.

**Pricing data is illustrative and will go stale** — check it against the
provider's own pricing page. Anything not listed below raises an error
unless you add it yourself via the `models` option on `ContextGuard`, with
no need to touch this file or this repo.

<!-- MODELS_TABLE:START -->
| Model id | Provider | Context window | Tiers (maxTokens: input/output $ per MTok) | Cache write/read $ per MTok |
|---|---|---|---|---|
| `claude-haiku-4-5` | anthropic | 200,000 | ≤200,000: $1/$5 | 1.25 / 0.1 |
| `claude-opus-4-5` | anthropic | 200,000 | ≤200,000: $5/$25 | 6.25 / 0.5 |
| `claude-sonnet-4-5` | anthropic | 1,000,000 | ≤200,000: $3/$15; ≤1,000,000: $6/$22.5 | 3.75 / 0.3 |
| `gpt-5` | openai | 400,000 | ≤400,000: $1.25/$10 | 0 / 0.125 |
| `gpt-5-mini` | openai | 400,000 | ≤400,000: $0.25/$2 | 0 / 0.025 |

<!-- MODELS_TABLE:END -->

## CLI

Both packages install a `thanos` command for checking a conversation from
a shell or a CI step, without writing any code:

```bash
# Python, after `pip install thanos`
thanos check conversation.json --model claude-sonnet-4-5

# JS/TS, no install needed
npx thanos check conversation.json --model claude-sonnet-4-5
```

```
model:           claude-sonnet-4-5
messages:        42 -> 42
tokens:          18234 (tier ceiling 200000)
estimated cost:  $0.054702
limit exceeded:  false
```

`conversation.json` is a JSON array of `{role, content}` messages (or an
object with a `"messages"` key); pass `-` to read from stdin instead of a
file. Add `--max-tokens`/`--max-cost-usd` to check against a budget, and
`--json` for a machine-readable report. The command exits `1` when the
limit is exceeded, so it doubles as a CI gate:

```bash
npx thanos check conversation.json --model claude-sonnet-4-5 --max-cost-usd 0.50 || echo "over budget"
```

`thanos models` (optionally with `--json`) lists the registry from either
package the same way.

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

## Development

```bash
# Python
pip install -e "./python[dev]"
ruff check python/thanos python/tests && ruff format --check python/thanos python/tests
pytest python/tests -q

# JS/TS
cd js && npm install
npm run lint   # tsc --noEmit + prettier --check
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) runs the same commands, plus a `docs` job
that regenerates the model table above and fails if `README.md` drifted.

## License

MIT — see [LICENSE](LICENSE).
