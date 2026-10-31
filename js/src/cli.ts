#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Budget } from "./budget.js";
import { ContextGuard } from "./guard.js";
import { loadModels } from "./pricing.js";
import type { Message } from "./tokenizer.js";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseFlags(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function readMessages(path: string): Message[] {
  const raw =
    path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  const payload = JSON.parse(raw);
  const messages = Array.isArray(payload) ? payload : payload?.messages;
  if (!Array.isArray(messages)) {
    throw new Error(
      'Input must be a JSON array of messages, or an object with a "messages" array.',
    );
  }
  return messages;
}

function stayInTierFrom(value: string): number | null {
  return value.toLowerCase() === "none" ? null : Number(value);
}

function cmdCheck(argv: string[]): number {
  const { positionals, flags } = parseFlags(argv);
  const file = positionals[0];
  const model = flags.model;
  if (!file || typeof model !== "string") {
    console.error("Usage: thanos check <file|-> --model <id> [options]");
    return 1;
  }

  const messages = readMessages(file);
  const maxTokens =
    flags["max-tokens"] !== undefined ? Number(flags["max-tokens"]) : undefined;
  const maxCostUsd =
    flags["max-cost-usd"] !== undefined
      ? Number(flags["max-cost-usd"])
      : undefined;
  const budget =
    maxTokens !== undefined || maxCostUsd !== undefined
      ? new Budget({ maxTokens, maxCostUsd })
      : undefined;

  const guard = new ContextGuard({
    model,
    budget,
    pinnedPrefixLen: Number(flags["pinned-prefix-len"] ?? 1),
    stayInTier: stayInTierFrom(String(flags["stay-in-tier"] ?? "0")),
  });

  const result = guard.prepare(messages, {
    estimatedOutputTokens: Number(flags["output-tokens"] ?? 0),
    cacheWriteTokens: Number(flags["cache-write-tokens"] ?? 0),
    cacheReadTokens: Number(flags["cache-read-tokens"] ?? 0),
    record: false,
  });

  const report = {
    model,
    inputMessages: messages.length,
    outputMessages: result.messages.length,
    tokens: result.tokens,
    tierMaxTokens: result.tierMaxTokens,
    estimatedCostUsd: Number(result.estimatedCostUsd.toFixed(6)),
    compressed: result.compressed,
    limitExceeded: result.limitExceeded,
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const suffix = report.compressed ? " (compressed)" : "";
    console.log(`model:           ${report.model}`);
    console.log(
      `messages:        ${report.inputMessages} -> ${report.outputMessages}${suffix}`,
    );
    console.log(
      `tokens:          ${report.tokens} (tier ceiling ${report.tierMaxTokens})`,
    );
    console.log(`estimated cost:  $${report.estimatedCostUsd.toFixed(6)}`);
    console.log(`limit exceeded:  ${report.limitExceeded}`);
  }

  return report.limitExceeded ? 1 : 0;
}

function cmdModels(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const models = loadModels();
  const entries = [...models.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (flags.json) {
    const out: Record<string, unknown> = {};
    for (const [id, m] of entries) {
      out[id] = { provider: m.provider, contextWindow: m.contextWindow };
    }
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const [id, m] of entries) {
      console.log(
        `${id.padEnd(22)} provider=${(m.provider ?? "-").padEnd(10)} contextWindow=${m.contextWindow}`,
      );
    }
  }
  return 0;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const [command, ...rest] = argv;
  if (command === "check") return cmdCheck(rest);
  if (command === "models") return cmdModels(rest);
  console.error("Usage: thanos <check|models> ...");
  return 1;
}

function isMainModule(): boolean {
  if (typeof process.argv[1] !== "string") return false;
  try {
    // `npm link`/global installs invoke this file through a symlink chain
    // (e.g. a global bin -> a linked node_modules entry -> this file), so
    // comparing against the raw argv[1] path misses; resolve both sides.
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main();
}
