import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModels } from "../src/pricing.js";

test("loads bundled models", () => {
  const models = loadModels();
  assert.ok(models.has("claude-sonnet-4-5"));
  const sonnet = models.get("claude-sonnet-4-5")!;
  assert.equal(sonnet.contextWindow, 1_000_000);
  assert.equal(sonnet.tiers.length, 2);
});

test("tierFor selects the cheaper tier below the threshold", () => {
  const models = loadModels();
  const sonnet = models.get("claude-sonnet-4-5")!;
  const cheap = sonnet.tierFor(100_000);
  const expensive = sonnet.tierFor(500_000);
  assert.ok(cheap.inputPerMTok < expensive.inputPerMTok);
});

test("estimateCostUsd bills cache tokens at the cache rate", () => {
  const models = loadModels();
  const haiku = models.get("claude-haiku-4-5")!;
  const cost = haiku.estimateCostUsd(1000, 0, 0, 1000);
  const expected = (1000 / 1_000_000) * haiku.cache.readPerMTok;
  assert.equal(cost, expected);
});

test("extra models override and extend the registry", () => {
  const models = loadModels({
    "my-custom-model": {
      contextWindow: 32000,
      tiers: [{ maxTokens: 32000, inputPerMTok: 0.5, outputPerMTok: 1.5 }],
    },
  });
  assert.ok(models.has("my-custom-model"));
  assert.equal(models.get("my-custom-model")!.contextWindow, 32000);
});
