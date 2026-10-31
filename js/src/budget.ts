export interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
}

/**
 * Cumulative ceiling for a conversation/session. Either limit is
 * optional; set only the one(s) you care about. `usedTokens`/`usedCostUsd`
 * are running totals that `ContextGuard` updates after each `prepare()`
 * call when `record: true` (the default).
 */
export class Budget {
  maxTokens?: number;
  maxCostUsd?: number;
  usedTokens = 0;
  usedCostUsd = 0;

  constructor(config: BudgetConfig = {}) {
    this.maxTokens = config.maxTokens;
    this.maxCostUsd = config.maxCostUsd;
  }

  record(tokens: number, costUsd: number): void {
    this.usedTokens += tokens;
    this.usedCostUsd += costUsd;
  }

  exceeded(): boolean {
    if (this.maxTokens !== undefined && this.usedTokens > this.maxTokens) {
      return true;
    }
    if (this.maxCostUsd !== undefined && this.usedCostUsd > this.maxCostUsd) {
      return true;
    }
    return false;
  }

  remainingTokens(fallback: number): number {
    if (this.maxTokens === undefined) return fallback;
    return Math.max(0, this.maxTokens - this.usedTokens);
  }
}
