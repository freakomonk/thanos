---
name: thanos-context
description: Use when building, reviewing, or debugging an LLM integration — direct Anthropic/OpenAI/Bedrock/Azure/OpenRouter calls, or any agent framework (LangChain, Vercel AI SDK, a hand-rolled agent loop) — that needs to track context-window limits, pricing tiers, prompt-cache cost, or a token/dollar budget, or that should compress conversation history automatically instead of growing it unbounded. Also use for a quick pre-flight/CI check of a saved conversation's token count, pricing tier, and estimated cost. Installs and wires up the `thanos` Python/TypeScript library and CLI (github.com/freakomonk/thanos).
---

# thanos: context limits, pricing tiers, and compression

## When to reach for this

LLM API pricing isn't flat — crossing a context-length threshold (e.g. a
"long context" tier above 200K tokens) or writing/reading the prompt
cache changes the per-token rate, sometimes by 2x or more. Use this skill
whenever the task involves:

- conversation/message history that grows across turns with no token or
  cost accounting
- a question about hitting a context-window limit, a pricing-tier jump,
  or prompt-cache cost
- a request to truncate, summarize, or compress history once it gets too
  large
- wanting a hard ceiling (tokens or dollars) on a conversation, enforced
  automatically
- sizing up or CI-gating a saved conversation (a JSON transcript) before
  it's sent

This applies regardless of framework: raw provider SDKs, LangChain,
Vercel AI SDK, a custom agent loop — `thanos` only ever operates on a
plain `[{role, content}]` message list, so it drops into any of them the
same way.

## How to use it

**1. Install** (zero runtime dependencies either way):

```bash
pip install thanos      # Python
npm install thanos      # TypeScript/JavaScript
```

**2. Wrap the message list immediately before the existing API call.**
Don't change how the call itself is made — only swap in the returned
messages:

```python
from thanos import ContextGuard

guard = ContextGuard(model="claude-sonnet-4-5")
result = guard.prepare(messages)
response = client.messages.create(model="claude-sonnet-4-5", messages=result.messages, ...)
# keep working from result.messages on the next turn, not the pre-compression list
```

```ts
import { ContextGuard } from "thanos";

const guard = new ContextGuard({ model: "claude-sonnet-4-5" });
const result = guard.prepare(messages);
const response = await client.messages.create({ model: "claude-sonnet-4-5", messages: result.messages, ... });
```

`result` carries `tokens`, `tier_max_tokens`/`tierMaxTokens`,
`estimated_cost_usd`/`estimatedCostUsd`, and `compressed` — log or branch
on these instead of guessing.

**3. For a budget ceiling** (tokens and/or dollars, checked alongside the
pricing-tier limit), pass a `Budget`:

```python
from thanos import Budget, ContextGuard
guard = ContextGuard(model="claude-sonnet-4-5", budget=Budget(max_cost_usd=5.00))
```

**4. For a no-code check** — sizing up a saved conversation, or as a CI
gate — use the CLI (exits `1` when a limit is exceeded):

```bash
thanos check conversation.json --model claude-sonnet-4-5          # after pip install
npx thanos check conversation.json --model claude-sonnet-4-5      # no install needed
```

`conversation.json` is a JSON array of `{role, content}` messages, or an
object with a `"messages"` key; pass `-` for stdin. `thanos models` lists
every supported model id.

## Model ids

Run `thanos models` / `npx thanos models`, or see
`python/thanos/data/models.json` in the repo for the full registry
(hundreds of models across direct provider APIs, AWS Bedrock, Azure AI
Foundry, and OpenRouter). If a model isn't listed, pass its pricing
directly via the `models=`/`models:` option — never required to fork or
edit this repo.

## Things to get right

- **Never call the model or the network from inside this skill's code
  changes** — `thanos` itself makes no network request; it's pure local
  bookkeeping run right before the real API call.
- **Don't touch the pinned prefix.** `pinnedPrefixLen`/`pinned_prefix_len`
  (default 1, the system message) marks what sits before the provider's
  cache breakpoint. The default compressor never reorders or drops
  anything inside it — busting that prefix forces an expensive cache
  rewrite on the next call.
- **It never raises by default.** Hitting a limit auto-compresses and
  fires `onLimit`/`on_limit`; only pass `raiseOnLimit`/`raise_on_limit=True`
  if the user explicitly wants a hard stop instead.
- **After compression, keep working from `result.messages`**, not the
  original list, or the next turn re-grows to the same size and
  compresses again every call.

Full docs, design rationale, and per-package usage:
https://github.com/freakomonk/thanos
