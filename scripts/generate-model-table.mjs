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

// The README table shows only the hand-curated entries (direct provider
// APIs, plus a handful of Bedrock/Azure flagships); `openrouter/*` entries
// are mirrored programmatically from OpenRouter's catalog and are too
// numerous (hundreds) to usefully print inline — they're summarized as a
// count instead. All of it is still in models.json and `thanos models`.
function buildTable(data) {
  const entries = Object.entries(data.models).sort(([a], [b]) => a.localeCompare(b));
  const curated = entries.filter(([, m]) => m.provider !== "openrouter");
  const openrouterCount = entries.length - curated.length;

  const rows = curated.map(([id, m]) => {
    const cache = m.cache ? `${m.cache.writePerMTok} / ${m.cache.readPerMTok}` : "-";
    return `| \`${id}\` | ${m.provider} | ${fmt(m.contextWindow)} | ${formatTiers(m.tiers)} | ${cache} |`;
  });

  const table = [
    "| Model id | Provider | Context window | Tiers (maxTokens: input/output $ per MTok) | Cache write/read $ per MTok |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");

  const note =
    `Plus **${fmt(openrouterCount)} more models** mirrored live from ` +
    "[OpenRouter's public catalog](https://openrouter.ai/api/v1/models) " +
    "as `openrouter/<slug>` (e.g. `openrouter/anthropic/claude-sonnet-4.5`, " +
    "`openrouter/google/gemini-3-pro`). Run `thanos models` / `npx thanos models` " +
    "to list all of them, or open `python/thanos/data/models.json`.";

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
