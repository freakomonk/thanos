import { test } from "node:test";
import assert from "node:assert/strict";
import { tiktokenTokenizer } from "../src/tokenizer.js";
import type { Message } from "../src/tokenizer.js";

function msg(role: string, content: string): Message {
  return { role, content };
}

test("tiktokenTokenizer counts real subword tokens", () => {
  const tokenizer = tiktokenTokenizer("gpt-5");
  const messages = [msg("user", "supercalifragilisticexpialidocious")];

  const tokens = tokenizer(messages);

  assert.ok(tokens > 4);
});

test("tiktokenTokenizer falls back to o200k_base for an unknown model", () => {
  const tokenizer = tiktokenTokenizer(
    "some-brand-new-model-tiktoken-has-never-heard-of",
  );

  assert.ok(tokenizer([msg("user", "hello world")]) > 0);
});
