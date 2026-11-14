#!/usr/bin/env node
// Refreshes the `openrouter/*` entries in python/thanos/data/models.json
// from OpenRouter's public /api/v1/models catalog. Every other entry
// (direct provider APIs, bedrock/*, azure/*) is hand-curated and left
// untouched.
//
// Run manually after editing, or let the scheduled "sync-openrouter"
// GitHub Actions workflow run it and open a PR when the catalog drifts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modelsPath = join(here, "..", "python", "thanos", "data", "models.json");

function round(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

async function fetchOpenRouterEntries() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`OpenRouter API returned ${res.status} ${res.statusText}`);
  }
  const { data } = await res.json();

  const entries = {};
  let skipped = 0;
  for (const m of data) {
    const contextWindow = m.context_length ?? m.top_provider?.context_length;
    const pricing = m.pricing ?? {};
    const prompt = pricing.prompt;
    const completion = pricing.completion;

    if (!m.id || !contextWindow || prompt == null || completion == null) {
      skipped++;
      continue;
    }

    const inputPerMTok = round(Number(prompt) * 1_000_000);
    const outputPerMTok = round(Number(completion) * 1_000_000);
    if (Number.isNaN(inputPerMTok) || Number.isNaN(outputPerMTok)) {
      skipped++;
      continue;
    }

    const entry = {
      provider: "openrouter",
      contextWindow: Math.trunc(contextWindow),
      tiers: [
        { maxTokens: Math.trunc(contextWindow), inputPerMTok, outputPerMTok },
      ],
    };

    const cacheWrite = pricing.input_cache_write ?? pricing.input_cache_write_1h;
    const cacheRead = pricing.input_cache_read;
    const cache = {};
    if (cacheWrite) cache.writePerMTok = round(Number(cacheWrite) * 1_000_000);
    if (cacheRead) cache.readPerMTok = round(Number(cacheRead) * 1_000_000);
    if (Object.keys(cache).length > 0) entry.cache = cache;

    entries[`openrouter/${m.id}`] = entry;
  }

  return { entries, total: data.length, skipped };
}

async function main() {
  const { entries: freshOpenRouterEntries, total, skipped } = await fetchOpenRouterEntries();

  const current = JSON.parse(readFileSync(modelsPath, "utf8"));
  const curated = Object.fromEntries(
    Object.entries(current.models).filter(([id]) => !id.startsWith("openrouter/")),
  );

  const merged = { ...curated, ...freshOpenRouterEntries };
  const out = {
    _disclaimer: current._disclaimer,
    models: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
  };

  writeFileSync(modelsPath, JSON.stringify(out, null, 2) + "\n");

  const openrouterCount = Object.keys(freshOpenRouterEntries).length;
  console.log(
    `Synced ${openrouterCount} openrouter/* entries (${skipped} of ${total} skipped for ` +
      `missing pricing/context data); ${Object.keys(curated).length} hand-curated entries left untouched.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
