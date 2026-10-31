import modelsData from "./data/models.json" with { type: "json" };

export interface PriceTier {
  maxTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface CacheRates {
  writePerMTok: number;
  readPerMTok: number;
}

export interface ModelProfileConfig {
  provider?: string;
  contextWindow: number;
  tiers: PriceTier[];
  cache?: Partial<CacheRates>;
}

export class ModelProfile {
  readonly modelId: string;
  readonly provider?: string;
  readonly contextWindow: number;
  readonly tiers: PriceTier[];
  readonly cache: CacheRates;

  constructor(modelId: string, config: ModelProfileConfig) {
    this.modelId = modelId;
    this.provider = config.provider;
    this.contextWindow = config.contextWindow;
    this.tiers = config.tiers;
    this.cache = {
      writePerMTok: config.cache?.writePerMTok ?? 0,
      readPerMTok: config.cache?.readPerMTok ?? 0,
    };
  }

  tierFor(tokens: number): PriceTier {
    for (const tier of this.tiers) {
      if (tokens <= tier.maxTokens) return tier;
    }
    return this.tiers[this.tiers.length - 1];
  }

  /**
   * `totalInputTokens` is the full prompt size (decides the pricing tier);
   * `cacheWriteTokens`/`cacheReadTokens` are the portions of it billed at
   * cache rates instead of the tier's input rate.
   */
  estimateCostUsd(
    totalInputTokens: number,
    outputTokens = 0,
    cacheWriteTokens = 0,
    cacheReadTokens = 0,
  ): number {
    const tier = this.tierFor(totalInputTokens);
    const freshTokens = Math.max(
      0,
      totalInputTokens - cacheWriteTokens - cacheReadTokens,
    );
    let cost = (freshTokens / 1_000_000) * tier.inputPerMTok;
    cost += (outputTokens / 1_000_000) * tier.outputPerMTok;
    cost += (cacheWriteTokens / 1_000_000) * this.cache.writePerMTok;
    cost += (cacheReadTokens / 1_000_000) * this.cache.readPerMTok;
    return cost;
  }
}

export type ModelRegistryOverrides = Record<string, ModelProfileConfig>;

export function loadModels(
  extra?: ModelRegistryOverrides,
): Map<string, ModelProfile> {
  const models = new Map<string, ModelProfile>();
  for (const [id, config] of Object.entries(
    modelsData.models as Record<string, ModelProfileConfig>,
  )) {
    models.set(id, new ModelProfile(id, config));
  }
  if (extra) {
    for (const [id, config] of Object.entries(extra)) {
      models.set(id, new ModelProfile(id, config));
    }
  }
  return models;
}

export function resolveModel(
  model: string | ModelProfile,
  extra?: ModelRegistryOverrides,
): ModelProfile {
  if (model instanceof ModelProfile) return model;
  const models = loadModels(extra);
  const resolved = models.get(model);
  if (!resolved) {
    throw new Error(
      `Unknown model id '${model}'. Pass a ModelProfile directly, or add it via ` +
        `the \`models\` option, e.g. new ContextGuard({ model: '${model}', models: { '${model}': {...} } }).`,
    );
  }
  return resolved;
}
