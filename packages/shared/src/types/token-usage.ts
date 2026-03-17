export type TokenUsage = {
  id: string
  agentId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  toolCallCount: number
  recordedAt: number
}

export type TokenUsageSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalToolCalls: number
  periodStart: number
  periodEnd: number
}
