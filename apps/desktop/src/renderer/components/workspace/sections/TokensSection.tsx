import type { TokenUsage, TokenUsageSummary } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useTokenHistory, useTokenScan, useTokenUsageSummary } from "../../../hooks/use-trpc";

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Summary Card ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-text-muted">{detail}</p>}
    </div>
  );
}

// ─── Model Breakdown ──────────────────────────────────────────────────────

function ModelBreakdown({ records }: { records: TokenUsage[] }) {
  const byModel = useMemo(() => {
    const map = new Map<string, { input: number; output: number; cost: number; count: number }>();
    for (const r of records) {
      const existing = map.get(r.model) ?? { input: 0, output: 0, cost: 0, count: 0 };
      existing.input += r.inputTokens;
      existing.output += r.outputTokens;
      existing.cost += r.estimatedCostUsd;
      existing.count += 1;
      map.set(r.model, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [records]);

  const maxCost = byModel[0]?.[1].cost ?? 1;

  if (byModel.length === 0) {
    return <p className="text-xs text-text-muted">No token data yet</p>;
  }

  return (
    <div className="space-y-2">
      {byModel.map(([model, data]) => (
        <div key={model} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-text-primary">{model}</span>
            <span className="tabular-nums text-text-muted">{formatCost(data.cost)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(data.cost / maxCost) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right text-[10px] tabular-nums text-text-muted">
              {formatTokens(data.input + data.output)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────

export function TokensSection() {
  const { project } = useProjectContext();
  const { data: summary } = useTokenUsageSummary(undefined, project?.id ?? undefined);
  const { data: history } = useTokenHistory(project?.id ?? null);
  const scanMutation = useTokenScan();

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Select a project to view token usage</p>
      </div>
    );
  }

  const s: TokenUsageSummary = summary ?? {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    totalToolCalls: 0,
    periodStart: 0,
    periodEnd: 0,
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Token Usage</h3>
            <p className="mt-0.5 text-xs text-text-muted">Last 24 hours for {project.name}</p>
          </div>
          <Button
            type="button"
            onClick={() => scanMutation.mutate({ projectId: project.id })}
            disabled={scanMutation.isPending}
            className={cn("gap-1.5 text-xs", scanMutation.isPending && "opacity-60")}
          >
            <RefreshCw className={cn("h-3 w-3", scanMutation.isPending && "animate-spin")} />
            {scanMutation.isPending ? "Scanning..." : "Scan Logs"}
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Total Cost" value={formatCost(s.totalCostUsd)} detail="Last 24h" />
          <SummaryCard
            label="Input Tokens"
            value={formatTokens(s.totalInputTokens)}
            detail="Prompts sent"
          />
          <SummaryCard
            label="Output Tokens"
            value={formatTokens(s.totalOutputTokens)}
            detail="Responses received"
          />
          <SummaryCard
            label="Tool Calls"
            value={String(s.totalToolCalls)}
            detail="API tool invocations"
          />
        </div>

        {/* Model breakdown */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Cost by Model
          </h4>
          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <ModelBreakdown records={history ?? []} />
          </div>
        </div>

        {/* Scan result */}
        {scanMutation.isSuccess && (
          <p className="text-xs text-text-muted">
            Imported {scanMutation.data.imported} entries from local CLI logs.
          </p>
        )}
      </div>
    </div>
  );
}
