import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";

function withCapturedStdout(fn: () => number): { code: number; out: string } {
  const originalLog = console.log;
  const originalError = console.error;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += args.join(" ") + "\n";
  };
  console.error = console.log;
  try {
    const code = fn();
    return { code, out };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function writeMessages(messages: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "thanos-cli-test-"));
  const path = join(dir, "conversation.json");
  writeFileSync(path, JSON.stringify(messages));
  return path;
}

test("check prints a report and returns 0 when under the limit", () => {
  const path = writeMessages([{ role: "user", content: "hello" }]);

  const { code, out } = withCapturedStdout(() =>
    main(["check", path, "--model", "claude-haiku-4-5"]),
  );

  assert.equal(code, 0);
  assert.match(out, /claude-haiku-4-5/);
  assert.match(out, /limit exceeded:\s+false/);
});

test("check --json emits valid, parseable JSON", () => {
  const path = writeMessages([{ role: "user", content: "hello" }]);

  const { code, out } = withCapturedStdout(() =>
    main(["check", path, "--model", "claude-haiku-4-5", "--json"]),
  );

  const report = JSON.parse(out);
  assert.equal(code, 0);
  assert.equal(report.model, "claude-haiku-4-5");
  assert.equal(report.limitExceeded, false);
});

test("check returns 1 when the budget is exceeded", () => {
  const path = writeMessages([{ role: "user", content: "x".repeat(4000) }]);

  const { code, out } = withCapturedStdout(() =>
    main([
      "check",
      path,
      "--model",
      "claude-haiku-4-5",
      "--max-tokens",
      "10",
      "--json",
    ]),
  );

  const report = JSON.parse(out);
  assert.equal(code, 1);
  assert.equal(report.limitExceeded, true);
});

test("check accepts an object with a messages key", () => {
  const path = writeMessages({ messages: [{ role: "user", content: "hi" }] });

  const { code } = withCapturedStdout(() =>
    main(["check", path, "--model", "claude-haiku-4-5"]),
  );

  assert.equal(code, 0);
});

test("models lists the bundled registry", () => {
  const { code, out } = withCapturedStdout(() => main(["models"]));

  assert.equal(code, 0);
  assert.match(out, /claude-sonnet-4-5/);
  assert.match(out, /gpt-5/);
});

test("models --json emits valid JSON", () => {
  const { code, out } = withCapturedStdout(() => main(["models", "--json"]));

  const registry = JSON.parse(out);
  assert.equal(code, 0);
  assert.equal(registry["claude-sonnet-4-5"].provider, "anthropic");
});
