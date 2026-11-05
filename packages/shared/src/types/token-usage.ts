export type TokenUsage = {
  id: string;
  /** null for rows imported from CLI logs, which belong to a project */
  agentId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  toolCallCount: number;
  recordedAt: number;
};

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
};
