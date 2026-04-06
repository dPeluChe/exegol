import type { DailyTrendRow, TokenUsageSummary } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Coins, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useAgentCosts,
  useDailyTrend,
  useModelBreakdown,
  useTokenScan,
  useTokenUsageSummary,
} from "../../../hooks/use-trpc";
import { formatCost, formatTokens } from "../../../lib/format";
import { trpcInvoke } from "../../../lib/trpc-client";
import { EmptyState } from "../../common";

// ─── Helpers ──────────────────────────────────────────────────────────────

// ─── Dynamic model pricing catalog (T19: DB-backed) ─────────────────────

function useModelCatalog() {
  return useQuery({
    queryKey: ["modelCatalog"],
    queryFn: () =>
      trpcInvoke<Record<string, { input: number; output: number }>>("settings.modelCatalog"),
    staleTime: 60_000,
  });
}

function getModelPrice(
  model: string,
  catalog: Record<string, { input: number; output: number }> | undefined,
): { input: number; output: number } | null {
  if (!catalog) return null;
  if (catalog[model]) return catalog[model];
  for (const [key, val] of Object.entries(catalog)) {
    if (model.startsWith(key) || key.startsWith(model)) return val;
  }
  return null;
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

// ─── Sparkline (inline SVG bar chart for daily trend) ────────────────────

function TrendChart({
  data,
  width = 400,
  height = 80,
}: {
  data: DailyTrendRow[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-bg-secondary p-4"
        style={{ height }}
      >
        <p className="text-xs text-text-muted">No trend data yet</p>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.totalCost), 0.001);
  const barWidth = Math.max(4, Math.min(16, (width - data.length * 2) / data.length));
  const totalWidth = data.length * (barWidth + 2);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-secondary p-4">
      <svg
        width={totalWidth}
        height={height + 20}
        className="block"
        role="img"
        aria-label="Daily cost trend chart"
      >
        {data.map((d, i) => {
          const barH = (d.totalCost / maxCost) * height;
          const x = i * (barWidth + 2);
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={height - barH}
                width={barWidth}
                height={barH}
                rx={2}
                className="fill-accent"
                opacity={0.8}
              />
              {/* Show date label every 5 bars */}
              {i % 5 === 0 && (
                <text x={x} y={height + 14} className="fill-text-muted text-[8px]">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Model Breakdown Table ───────────────────────────────────────────────

function ModelBreakdownTable({ projectId, days }: { projectId: string; days: number }) {
  const { data: models } = useModelBreakdown(projectId, days);
  const { data: catalog } = useModelCatalog();
  const maxCost = models?.[0]?.totalCost ?? 1;

  if (!models || models.length === 0) {
    return <p className="text-xs text-text-muted">No token data yet</p>;
  }

  return (
    <div className="space-y-2">
      {models.map((m) => {
        const price = getModelPrice(m.model, catalog);
        return (
          <div key={`${m.provider}/${m.model}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{m.model}</span>
                <span className="text-[10px] text-text-muted">{m.provider}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-text-muted">
                  {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)} out
                </span>
                <span className="w-16 text-right font-medium tabular-nums text-text-primary">
                  {formatCost(m.totalCost)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(m.totalCost / maxCost) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right text-[10px] tabular-nums text-text-muted">
                {m.requestCount} req{m.requestCount !== 1 ? "s" : ""}
              </span>
            </div>
            {price && (
              <p className="text-[10px] text-text-muted">
                ${(price.input * 1e6).toFixed(2)}/M in \u00b7 ${(price.output * 1e6).toFixed(2)}/M
                out
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Agent Cost Table ────────────────────────────────────────────────────

function AgentCostTable({ projectId, days }: { projectId: string; days: number }) {
  const { data: agents } = useAgentCosts(projectId, days);

  if (!agents || agents.length === 0) {
    return <p className="text-xs text-text-muted">No agent cost data yet</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-bg-tertiary text-text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Agent</th>
            <th className="px-3 py-2 text-left font-medium">Task</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Avg/Session</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((a) => (
            <tr key={a.agentId} className="bg-bg-secondary text-text-secondary">
              <td className="px-3 py-2 font-medium text-text-primary">{a.cliType}</td>
              <td className="max-w-[200px] truncate px-3 py-2">{a.taskDescription}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(a.totalTokens)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatCost(a.totalCost)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                {a.sessionCount > 0 ? formatCost(a.totalCost / a.sessionCount) : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────

export function TokensSection() {
  const { project } = useProjectContext();
  const [days, setDays] = useState(30);
  const { data: summary } = useTokenUsageSummary(undefined, project?.id ?? undefined);
  const { data: trendData } = useDailyTrend(project?.id ?? null, days);
  const scanMutation = useTokenScan();

  if (!project) {
    return (
      <EmptyState
        icon={<Coins className="h-8 w-8 text-text-muted" />}
        title="No project selected"
        description="Select a project to view token usage"
        className="h-full"
      />
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
            <h3 className="text-sm font-semibold text-text-primary">Token Usage & Costs</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Last {days} days for {project.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Period selector */}
            <div className="flex rounded-md border border-border bg-bg-secondary">
              {[7, 14, 30].map((d) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-medium transition-colors",
                    days === d ? "bg-accent text-white" : "text-text-muted hover:text-text-primary",
                  )}
                >
                  {d}d
                </button>
              ))}
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
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard
            label="Total Cost"
            value={formatCost(s.totalCostUsd)}
            detail="Period total"
          />
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

        {/* Daily trend chart */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Daily Cost Trend
          </h4>
          <TrendChart data={trendData ?? []} width={600} height={60} />
        </div>

        {/* Model breakdown */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Cost by Model
          </h4>
          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <ModelBreakdownTable projectId={project.id} days={days} />
          </div>
        </div>

        {/* Per-agent costs */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Cost by Agent
          </h4>
          <AgentCostTable projectId={project.id} days={days} />
        </div>

        {/* Scan result */}
        {scanMutation.isSuccess && (
          <p className="text-xs text-text-muted">
            Imported {scanMutation.data.imported} entries from local CLI logs.
            {scanMutation.data.skipped > 0 && ` (${scanMutation.data.skipped} duplicates skipped)`}
          </p>
        )}
      </div>
    </div>
  );
}
