# thanos (JS/TS)

Keep an LLM conversation inside its context window and pricing tier, track
spend, and compress history automatically when a limit is hit.

```bash
npm install thanos
```

```ts
import { ContextGuard } from "thanos";

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
import { Budget, ContextGuard } from "thanos";

const budget = new Budget({ maxCostUsd: 5.0 });
const guard = new ContextGuard({ model: "claude-sonnet-4-5", budget });

for (const turn of conversation) {
  const result = guard.prepare(turn.messages); // auto-compresses once maxCostUsd is projected to be exceeded
}
```

## Custom compression

```ts
import { ContextGuard, type Compressor } from "thanos";

const summarizeAndTruncate: Compressor = (messages, targetTokens, pinnedPrefixLen, tokenizer) => {
  // Your own strategy — e.g. call an LLM to summarize the dropped turns
  // into one system note, then fall back to truncation.
};

const guard = new ContextGuard({ model: "claude-sonnet-4-5", compressor: summarizeAndTruncate });
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
