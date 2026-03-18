export type ModelBreakdownRow = {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
};

export type AgentCostRow = {
  agentId: string;
  cliType: string;
  taskDescription: string;
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
};

export type DailyTrendRow = {
  date: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
};

export type MetricsSnapshot = {
  cpu: number;
  memoryPercent: number;
  diskPercent: number;
  timestamp: number;
};
