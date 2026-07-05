export type BudgetPeriod = "daily" | "weekly";
export type BudgetLimitType = "tokens" | "dollars";

export interface Budget {
  id: string;
  projectId: string;
  period: BudgetPeriod;
  limitType: BudgetLimitType;
  limitValue: number;
  hardStop: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BudgetStatus {
  budget: Budget | null;
  /** In tokens or dollars, matching budget.limitType */
  currentUsage: number;
  periodStart: number;
  periodEnd: number;
  percentUsed: number;
}
