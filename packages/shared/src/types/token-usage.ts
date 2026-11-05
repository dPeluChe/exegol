export type TokenUsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalToolCalls: number;
  periodStart: number;
  periodEnd: number;
};

/** Rows whose model has no price: counted here, never in costUsd */
export type UnpricedUsage = { records: number; tokens: number };

export type UsageTotals = {
  /** Uncached input */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Priced and log-reported rows only; null when every row is unpriced */
  costUsd: number | null;
  records: number;
  toolCalls: number;
  /** Cache reads over all input (uncached + reads + writes); null with no input */
  cacheHitRate: number | null;
  unpriced: UnpricedUsage;
};

export type UsageModelRow = UsageTotals & {
  model: string;
  provider: string;
  /** USD per 1M tokens from the price table; null when the model has none */
  listPrice: { input: number; output: number } | null;
  /** costUsd per 1M tokens of the priced rows; null when none is priced */
  costPerMTok: number | null;
};

export type UsageReport = {
  since: number;
  until: number;
  /** Unix seconds of the last background import; null before the first */
  lastImportAt: number | null;
  totals: UsageTotals;
  byProject: (UsageTotals & { projectId: string; projectName: string })[];
  /** claude-code, codex, aider, or the agent's cli_type */
  byCli: (UsageTotals & { cli: string })[];
  byProvider: (UsageTotals & { provider: string })[];
  byModel: UsageModelRow[];
  /** Local day, YYYY-MM-DD, ascending */
  byDay: (UsageTotals & { date: string })[];
  /** Heaviest first, capped; `label` is the alias or task of the session Exegol ran */
  bySession: (UsageTotals & {
    session: string;
    cli: string;
    projectName: string;
    label?: string;
  })[];
};

/** The two warning points of a budget or a CLI limit */
export function limitThreshold(percent: number): 80 | 100 | null {
  return percent >= 100 ? 100 : percent >= 80 ? 80 : null;
}

export type UsageLimit = {
  cli: string;
  /** USD a month; null when only spent */
  limitUsd: number | null;
  spentUsd: number;
};
