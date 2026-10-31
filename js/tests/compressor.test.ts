import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateCompressor } from "../src/compressor.js";
import { estimateTokens, type Message } from "../src/tokenizer.js";

function msg(role: string, content: string): Message {
  return { role, content };
}

test("truncate keeps the pinned prefix untouched", () => {
  const messages = [
    msg("system", "You are a helpful assistant. ".repeat(5)),
    msg("user", "turn 1 ".repeat(50)),
    msg("assistant", "turn 1 reply ".repeat(50)),
    msg("user", "turn 2 ".repeat(50)),
    msg("assistant", "turn 2 reply ".repeat(50)),
    msg("user", "most recent turn ".repeat(5)),
  ];
  const target = estimateTokens([messages[0], messages[messages.length - 1]]) + 5;

  const result = truncateCompressor(messages, target, 1, estimateTokens);

  assert.deepEqual(result[0], messages[0]);
  assert.ok(estimateTokens(result) <= target || result.length === 1);
});

test("truncate drops the oldest turns first", () => {
  const messages = [
    msg("system", "sys"),
    msg("user", "oldest"),
    msg("assistant", "oldest reply"),
    msg("user", "newest"),
  ];
  const target = estimateTokens([messages[0], messages[messages.length - 1]]);

  const result = truncateCompressor(messages, target, 1, estimateTokens);

  assert.equal(result[0].role, "system");
  assert.deepEqual(result[result.length - 1], messages[messages.length - 1]);
  assert.ok(!result.includes(messages[1]));
});

test("truncate never touches the pinned prefix even if it is oversized", () => {
  const messages = [msg("system", "x".repeat(10_000)), msg("user", "hi")];

  const result = truncateCompressor(messages, 1, 1, estimateTokens);

  assert.deepEqual(result, [messages[0]]);
});
