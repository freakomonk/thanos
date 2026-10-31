import { Budget } from "./budget.js";
import type { Compressor } from "./compressor.js";
import { truncateCompressor } from "./compressor.js";
import type { ModelRegistryOverrides } from "./pricing.js";
import { ModelProfile, resolveModel } from "./pricing.js";
import type { Message, Tokenizer } from "./tokenizer.js";
import { estimateTokens } from "./tokenizer.js";

export class LimitExceeded extends Error {}

export interface GuardResult {
  messages: Message[];
  tokens: number;
  tierMaxTokens: number;
  estimatedCostUsd: number;
  compressed: boolean;
  limitExceeded: boolean;
}

export interface LimitInfo {
  tokens: number;
  ceiling: number;
  compressed: boolean;
  limitExceeded: boolean;
  estimatedCostUsd: number;
}

export interface ContextGuardOptions {
  model: string | ModelProfile;
  models?: ModelRegistryOverrides;
  budget?: Budget;
  tokenizer?: Tokenizer;
  compressor?: Compressor;
  /** How many leading messages sit before the provider's cache breakpoint. */
  pinnedPrefixLen?: number;
  /** Index into `model.tiers` to treat as the ceiling (0 = cheapest tier,
   * i.e. never let the prompt grow into a pricier tier). Pass `null` to
   * ignore tiers and only cap at the model's hard context window. */
  stayInTier?: number | null;
  /** Throw `LimitExceeded` instead of just notifying `onLimit`. */
  raiseOnLimit?: boolean;
  onLimit?: (info: LimitInfo) => void;
}

export interface PrepareOptions {
  estimatedOutputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** Update the attached `Budget`'s running totals. Default true. */
  record?: boolean;
}

export class ContextGuard {
  private readonly model: ModelProfile;
  private readonly budget?: Budget;
  private readonly tokenizer: Tokenizer;
  private readonly compressor: Compressor;
  private readonly pinnedPrefixLen: number;
  private readonly stayInTier: number | null;
  private readonly raiseOnLimit: boolean;
  private readonly onLimit?: (info: LimitInfo) => void;

  constructor(options: ContextGuardOptions) {
    this.model = resolveModel(options.model, options.models);
    this.budget = options.budget;
    this.tokenizer = options.tokenizer ?? estimateTokens;
    this.compressor = options.compressor ?? truncateCompressor;
    this.pinnedPrefixLen = options.pinnedPrefixLen ?? 1;
    this.stayInTier = options.stayInTier === undefined ? 0 : options.stayInTier;
    this.raiseOnLimit = options.raiseOnLimit ?? false;
    this.onLimit = options.onLimit;
  }

  private ceiling(): number {
    let ceiling =
      this.stayInTier !== null
        ? this.model.tiers[this.stayInTier].maxTokens
        : this.model.contextWindow;
    if (this.budget) {
      ceiling = Math.min(ceiling, this.budget.remainingTokens(ceiling));
    }
    return ceiling;
  }

  prepare(messages: Message[], options: PrepareOptions = {}): GuardResult {
    const {
      estimatedOutputTokens = 0,
      cacheWriteTokens = 0,
      cacheReadTokens = 0,
      record = true,
    } = options;

    const ceiling = this.ceiling();
    let tokens = this.tokenizer(messages);
    let compressed = false;
    let outMessages = messages;

    if (tokens > ceiling) {
      outMessages = this.compressor(
        messages,
        ceiling,
        this.pinnedPrefixLen,
        this.tokenizer,
      );
      tokens = this.tokenizer(outMessages);
      compressed = true;
    }

    let limitExceeded = tokens > ceiling;
    const cost = this.model.estimateCostUsd(
      tokens,
      estimatedOutputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    );

    if (this.budget && record) {
      this.budget.record(tokens + estimatedOutputTokens, cost);
      if (this.budget.exceeded()) limitExceeded = true;
    }

    if (limitExceeded || compressed) {
      const info: LimitInfo = {
        tokens,
        ceiling,
        compressed,
        limitExceeded,
        estimatedCostUsd: cost,
      };
      this.onLimit?.(info);
      if (limitExceeded && this.raiseOnLimit) {
        throw new LimitExceeded(
          `Context guard limit exceeded for model '${this.model.modelId}': ` +
            `${tokens} tokens > ceiling of ${ceiling}.`,
        );
      }
    }

    const tier = this.model.tierFor(tokens);
    return {
      messages: outMessages,
      tokens,
      tierMaxTokens: tier.maxTokens,
      estimatedCostUsd: cost,
      compressed,
      limitExceeded,
    };
  }
}
