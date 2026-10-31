#!/usr/bin/env node
// Regenerates the "Supported models" table in README.md from the
// canonical registry at python/thanos/data/models.json. Run this after
// editing that file; CI fails if README.md drifts out of sync (see
// .github/workflows/ci.yml, job "docs").
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const modelsPath = join(root, "python", "thanos", "data", "models.json");
const readmePath = join(root, "README.md");

const START = "<!-- MODELS_TABLE:START -->";
const END = "<!-- MODELS_TABLE:END -->";

function fmt(n) {
  return n.toLocaleString("en-US");
}

function formatTiers(tiers) {
  return tiers
    .map((t) => `≤${fmt(t.maxTokens)}: $${t.inputPerMTok}/$${t.outputPerMTok}`)
    .join("; ");
}

// The README table shows only a fixed top-15 (the direct-provider models
// plus a few flagship Bedrock/Azure/Nova/Llama/Mistral entries) so it
// stays scannable; the full registry (currently 472 entries, including
// 456 mirrored from OpenRouter) lives in models.json and `thanos models`.
// Update this list by hand when it's worth swapping an entry in or out.
const TOP_MODEL_IDS = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "gpt-5",
  "gpt-5-mini",
  "bedrock/claude-sonnet-4-5",
  "bedrock/claude-opus-4-5",
  "bedrock/claude-haiku-4-5",
  "bedrock/nova-pro",
  "bedrock/nova-lite",
  "bedrock/nova-micro",
  "bedrock/llama-3.3-70b",
  "bedrock/mistral-large",
  "azure/gpt-5",
  "azure/gpt-4o",
];

function buildTable(data) {
  const total = Object.keys(data.models).length;

  const rows = TOP_MODEL_IDS.map((id) => {
    const m = data.models[id];
    if (!m) throw new Error(`generate-model-table.mjs: '${id}' is in TOP_MODEL_IDS but missing from models.json`);
    const cache = m.cache ? `${m.cache.writePerMTok} / ${m.cache.readPerMTok}` : "-";
    return `| \`${id}\` | ${m.provider} | ${fmt(m.contextWindow)} | ${formatTiers(m.tiers)} | ${cache} |`;
  });

  const table = [
    "| Model id | Provider | Context window | Tiers (maxTokens: input/output $ per MTok) | Cache write/read $ per MTok |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");

  const note =
    `Showing ${TOP_MODEL_IDS.length} of **${fmt(total)} models** — see ` +
    "[`python/thanos/data/models.json`](python/thanos/data/models.json) " +
    "for the full list (including all OpenRouter-mirrored entries as " +
    "`openrouter/<slug>`), or run `thanos models` / `npx thanos models`.";

  return `${table}\n\n${note}`;
}

const data = JSON.parse(readFileSync(modelsPath, "utf8"));
const table = buildTable(data);
const readme = readFileSync(readmePath, "utf8");

const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const before = readme.slice(0, startIdx + START.length);
const after = readme.slice(endIdx);
const updated = `${before}\n${table}\n\n${after}`;

if (updated === readme) {
  console.log("README.md model table already up to date.");
} else {
  writeFileSync(readmePath, updated);
  console.log("README.md model table regenerated.");
}
