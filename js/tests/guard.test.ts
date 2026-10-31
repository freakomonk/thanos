import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextGuard, LimitExceeded } from "../src/guard.js";
import { Budget } from "../src/budget.js";
import { ModelProfile } from "../src/pricing.js";
import type { Message } from "../src/tokenizer.js";

function msg(role: string, content: string): Message {
  return { role, content };
}

test("prepare returns stats without compression when under the limit", () => {
  const guard = new ContextGuard({ model: "claude-haiku-4-5" });
  const messages = [msg("user", "hello there")];

  const result = guard.prepare(messages);

  assert.equal(result.compressed, false);
  assert.equal(result.limitExceeded, false);
  assert.ok(result.tokens > 0);
  assert.deepEqual(result.messages, messages);
});

test("prepare compresses when over the tier ceiling", () => {
  const guard = new ContextGuard({ model: "claude-haiku-4-5", stayInTier: 0 });
  const bigHistory = [msg("system", "sys")].concat(
    Array.from({ length: 300 }, () => msg("user", "x".repeat(4000))),
  );

  const result = guard.prepare(bigHistory);

  assert.equal(result.compressed, true);
  assert.ok(result.messages.length < bigHistory.length);
  assert.equal(result.messages[0].role, "system");
});

test("onLimit callback fires and does not throw by default", () => {
  const calls: unknown[] = [];
  const guard = new ContextGuard({
    model: "claude-haiku-4-5",
    stayInTier: 0,
    onLimit: (info) => calls.push(info),
  });
  const bigHistory = [msg("system", "sys")].concat(
    Array.from({ length: 300 }, () => msg("user", "x".repeat(4000))),
  );

  guard.prepare(bigHistory);

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { compressed: boolean }).compressed, true);
});

test("budget ceiling triggers the limit and raiseOnLimit throws", () => {
  const budget = new Budget({ maxTokens: 50 });
  const guard = new ContextGuard({
    model: "claude-haiku-4-5",
    budget,
    raiseOnLimit: true,
  });

  assert.throws(
    () => guard.prepare([msg("user", "x".repeat(4000))]),
    LimitExceeded,
  );
});

test("custom tokenizer and compressor are used", () => {
  const calls = { tokenizer: 0, compressor: 0 };
  const tinyModel = new ModelProfile("tiny", {
    contextWindow: 5,
    tiers: [{ maxTokens: 5, inputPerMTok: 1, outputPerMTok: 1 }],
  });
  const guard = new ContextGuard({
    model: tinyModel,
    stayInTier: null,
    tokenizer: () => {
      calls.tokenizer += 1;
      return 10;
    },
    compressor: (messages) => {
      calls.compressor += 1;
      return messages;
    },
  });

  const result = guard.prepare([msg("user", "hi")]);

  assert.ok(calls.tokenizer >= 1);
  assert.equal(calls.compressor, 1);
  assert.equal(result.tokens, 10);
});
