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

function buildTable(data) {
  const rows = Object.entries(data.models)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, m]) => {
      const cache = m.cache ? `${m.cache.writePerMTok} / ${m.cache.readPerMTok}` : "-";
      return `| \`${id}\` | ${m.provider} | ${fmt(m.contextWindow)} | ${formatTiers(m.tiers)} | ${cache} |`;
    });
  return [
    "| Model id | Provider | Context window | Tiers (maxTokens: input/output $ per MTok) | Cache write/read $ per MTok |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
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
