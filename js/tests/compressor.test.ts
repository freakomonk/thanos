import { test } from "node:test";
import assert from "node:assert/strict";
import {
  truncateCompressor,
  priorityTruncateCompressor,
  makeSummarizingCompressor,
} from "../src/compressor.js";
import { estimateTokens, type Message } from "../src/tokenizer.js";

function msg(role: string, content: unknown): Message {
  return { role, content };
}

function toolMsg(text: string): Message {
  return { role: "assistant", content: [{ type: "tool_use", text }] };
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
  const target =
    estimateTokens([messages[0], messages[messages.length - 1]]) + 5;

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

test("priorityTruncate keeps tool messages over ordinary ones", () => {
  const messages = [
    msg("system", "sys"),
    msg("user", "ordinary chit-chat ".repeat(20)),
    toolMsg("important tool result ".repeat(20)),
    msg("user", "most recent ".repeat(5)),
  ];
  const target = estimateTokens([messages[0], messages[2], messages[3]]);

  const result = priorityTruncateCompressor(
    messages,
    target,
    1,
    estimateTokens,
  );

  assert.ok(result.includes(messages[2]));
  assert.ok(!result.includes(messages[1]));
});

test("priorityTruncate never touches the pinned prefix", () => {
  const messages = [msg("system", "x".repeat(10_000)), msg("user", "hi")];

  const result = priorityTruncateCompressor(messages, 1, 1, estimateTokens);

  assert.deepEqual(result, [messages[0]]);
});

test("makeSummarizingCompressor replaces dropped history with a summary", () => {
  const messages = [msg("system", "sys")].concat(
    Array.from({ length: 10 }, (_, i) => msg("user", `turn ${i} `.repeat(10))),
  );
  const calls: Message[][] = [];

  const compressor = makeSummarizingCompressor(
    (dropped) => {
      calls.push(dropped);
      return "condensed history";
    },
    { keepRecent: 2 },
  );
  const target =
    estimateTokens([messages[0]]) + estimateTokens(messages.slice(-2)) + 50;
  assert.ok(target < estimateTokens(messages));

  const result = compressor(messages, target, 1, estimateTokens);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, messages.length - 1 - 2);
  assert.deepEqual(result[0], messages[0]);
  assert.ok(String(result[1].content).includes("condensed history"));
  assert.deepEqual(result.slice(-2), messages.slice(-2));
});

test("makeSummarizingCompressor falls back when nothing to summarize", () => {
  const messages = [msg("system", "sys"), msg("user", "only one turn")];
  const calls: Message[][] = [];

  const compressor = makeSummarizingCompressor(
    (dropped) => {
      calls.push(dropped);
      return "should not be called";
    },
    { keepRecent: 4 },
  );

  const result = compressor(messages, 1, 1, estimateTokens);

  assert.equal(calls.length, 0);
  assert.deepEqual(result, [messages[0]]);
});

test("makeSummarizingCompressor trims recent while protecting the summary", () => {
  const messages = [msg("system", "sys")].concat(
    Array.from({ length: 6 }, (_, i) => msg("user", `turn ${i} `.repeat(30))),
  );

  const compressor = makeSummarizingCompressor(
    () => "condensed summary of history",
    {
      keepRecent: 3,
    },
  );
  const summaryText =
    "[Summary of 3 earlier messages]\ncondensed summary of history";
  const summaryMsg = msg("system", summaryText);
  const target = estimateTokens([
    messages[0],
    summaryMsg,
    messages[messages.length - 1],
  ]);

  const result = compressor(messages, target, 1, estimateTokens);

  assert.deepEqual(result[0], messages[0]);
  assert.ok(String(result[1].content).includes("condensed summary of history"));
  assert.deepEqual(result[result.length - 1], messages[messages.length - 1]);
  assert.ok(estimateTokens(result) <= target);
});
