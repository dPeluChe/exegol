import type { BudgetLimitType, BudgetPeriod } from "@exegol/shared";
import { Button, cn, Input } from "@exegol/ui";
import { useState } from "react";
import { useBudgetStatus, useUpsertBudget } from "../../../hooks/use-trpc";
import { formatCost, formatTokens } from "../../../lib/format";
import { thresholdBarColor, thresholdColor } from "./resource-format";

function formatByType(value: number, limitType: BudgetLimitType): string {
  return limitType === "dollars" ? formatCost(value) : formatTokens(value);
}

function BudgetRow({ projectId, period }: { projectId: string; period: BudgetPeriod }) {
  const { data: status } = useBudgetStatus(projectId, period);
  const upsertBudget = useUpsertBudget();
  const [editing, setEditing] = useState(false);
  const [limitType, setLimitType] = useState<BudgetLimitType>("dollars");
  const [limitValue, setLimitValue] = useState("");
  const [hardStop, setHardStop] = useState(false);

  const startEditing = () => {
    setLimitType(status?.budget?.limitType ?? "dollars");
    setLimitValue(status?.budget ? String(status.budget.limitValue) : "");
    setHardStop(status?.budget?.hardStop ?? false);
    setEditing(true);
  };

  const handleSave = () => {
    const value = Number.parseFloat(limitValue);
    if (!value || value <= 0) return;
    upsertBudget.mutate(
      { projectId, period, limitType, limitValue: value, hardStop },
      { onSuccess: () => setEditing(false) },
    );
  };

  const percent = status?.percentUsed ?? 0;
  const label = period === "daily" ? "Daily Budget" : "Weekly Budget (rolling 7d)";

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="text-[10px] text-accent hover:underline"
          >
            {status?.budget ? "Edit" : "Set budget"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <select
              value={limitType}
              onChange={(e) => setLimitType(e.target.value as BudgetLimitType)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            >
              <option value="dollars">$</option>
              <option value="tokens">tokens</option>
            </select>
            <Input
              value={limitValue}
              onChange={(e) => setLimitValue(e.target.value)}
              placeholder={limitType === "dollars" ? "10.00" : "1000000"}
              className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-xs text-[var(--text-primary)]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <input
              type="checkbox"
              checked={hardStop}
              onChange={(e) => setHardStop(e.target.checked)}
            />
            Hard-stop scheduled/automation runs at 100%
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              className="h-7 text-xs text-text-secondary"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={upsertBudget.isPending}
              className="h-7 bg-accent text-xs text-white"
            >
              Save
            </Button>
          </div>
        </div>
      ) : status?.budget ? (
        <>
          <p className="mt-1 text-xl font-bold text-text-primary">
            {formatByType(status.currentUsage, status.budget.limitType)}
            <span className="text-xs font-normal text-text-muted">
              {" "}
              / {formatByType(status.budget.limitValue, status.budget.limitType)}
            </span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className={cn("h-full rounded-full transition-all", thresholdBarColor(percent))}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <p className={cn("mt-1 text-[10px]", thresholdColor(percent))}>
            {percent.toFixed(0)}% used
            {status.budget.hardStop && percent >= 100 ? " · scheduled runs blocked" : ""}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-text-muted">No budget set</p>
      )}
    </div>
  );
}

export function BudgetsCard({ projectId }: { projectId: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BudgetRow projectId={projectId} period="daily" />
      <BudgetRow projectId={projectId} period="weekly" />
    </div>
  );
}
