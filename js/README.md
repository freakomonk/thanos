# thanos (JS/TS)

Keep an LLM conversation inside its context window and pricing tier, track
spend, and compress history automatically when a limit is hit.

```bash
npm install thanos-ctx
```

(Published as `thanos-ctx` — the bare `thanos` name on npm belongs to an
unrelated project.)

```ts
import { ContextGuard } from "thanos-ctx";

const guard = new ContextGuard({ model: "claude-sonnet-4-5" });

const messages = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "..." },
  // ... growing conversation history
];

const result = guard.prepare(messages);

// Send result.messages to the API instead of the original array.
const response = await client.messages.create({
  model: "claude-sonnet-4-5",
  messages: result.messages,
  // ...
});

console.log(result.tokens, result.estimatedCostUsd, result.compressed);
```

## Budgets

```ts
import { Budget, ContextGuard } from "thanos-ctx";

const budget = new Budget({ maxCostUsd: 5.0 });
const guard = new ContextGuard({ model: "claude-sonnet-4-5", budget });

for (const turn of conversation) {
  const result = guard.prepare(turn.messages); // auto-compresses once maxCostUsd is projected to be exceeded
}
```

`prepare()` records an *estimate* before you've sent the request. Once
the real response comes back, reconcile the budget with what you were
actually billed:

```ts
const response = await client.messages.create({ model: "claude-sonnet-4-5", messages: result.messages, max_tokens: 1024 });

guard.recordActual(result, {
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  cacheReadTokens: response.usage.cache_read_input_tokens,
});
```

This adjusts `budget.usedTokens`/`usedCostUsd` by the delta between the
real numbers and the original estimate, so the running total tracks
actual spend rather than compounding estimation error over a long
session. Safe to call even with no `Budget` attached — it just returns
the real cost.

## Compression strategies

The default `truncateCompressor` drops the oldest non-pinned turns.
Two more ship built in:

```ts
import { ContextGuard, priorityTruncateCompressor } from "thanos-ctx";

// Keeps tool-call/tool-result turns longer than ordinary chat turns when
// something has to be dropped.
const guard = new ContextGuard({ model: "claude-sonnet-4-5", compressor: priorityTruncateCompressor });
```

```ts
import { ContextGuard, makeSummarizingCompressor } from "thanos-ctx";

function summarize(droppedMessages: unknown[]): string {
  // Your own call to an LLM (or anything else) — thanos never calls a
  // model itself. Return a short summary of `droppedMessages`.
}

const guard = new ContextGuard({
  model: "claude-sonnet-4-5",
  compressor: makeSummarizingCompressor(summarize, { keepRecent: 4 }),
});
```

`makeSummarizingCompressor` keeps the pinned prefix and the last
`keepRecent` messages verbatim, and replaces everything else with one
condensed system message — so compression loses a summary's worth of
detail instead of the turns outright. Falls back to truncation (or a
`fallback` compressor you supply) if there's nothing worth summarizing,
or the summary itself still doesn't fit.

You can of course write your own instead:

```ts
import { ContextGuard, type Compressor } from "thanos-ctx";

const myCompressor: Compressor = (messages, targetTokens, pinnedPrefixLen, tokenizer) => {
  // Your own strategy.
};

const guard = new ContextGuard({ model: "claude-sonnet-4-5", compressor: myCompressor });
```

## Reacting to limits

```ts
const guard = new ContextGuard({
  model: "claude-sonnet-4-5",
  onLimit: (info) => {
    console.log(`compressed=${info.compressed} tokens=${info.tokens} cost=$${info.estimatedCostUsd.toFixed(4)}`);
  },
});
```

Pass `raiseOnLimit: true` to throw `LimitExceeded` instead of just notifying `onLimit`.

## Exact token counts

The default `estimateTokens` is a fast, offline ~4-chars-per-token
heuristic. For exact counts on OpenAI-family models:

```ts
import { ContextGuard, tiktokenTokenizer } from "thanos-ctx";

// Local, no network call. Requires `npm install js-tiktoken`.
const guard = new ContextGuard({ model: "gpt-5", tokenizer: tiktokenTokenizer("gpt-5") });
```

There's no JS equivalent of Python's `anthropic_count_tokens_tokenizer`.
Anthropic's `count_tokens` call is async, and `Tokenizer`/`prepare()`
here are synchronous by design — bolting an async exact-count path onto
a sync API would be a bigger change than "add a tokenizer." For an exact
Claude count in JS, call the API yourself and reconcile afterward with
[`recordActual`](#budgets) instead of pre-counting.

## Adding or overriding a model

```ts
const guard = new ContextGuard({
  model: "my-self-hosted-model",
  models: {
    "my-self-hosted-model": {
      contextWindow: 128_000,
      tiers: [{ maxTokens: 128_000, inputPerMTok: 0, outputPerMTok: 0 }],
    },
  },
});
```

See the [top-level README](../README.md) for the full design rationale.
