import type { UsageLimit, UsageReport, UsageTotals } from "@exegol/shared";
import { cn, Input } from "@exegol/ui";
import { useState } from "react";
import { useSetUsageLimit, useUsageLimits } from "../../../hooks/use-trpc";
import { formatCost, formatTokens } from "../../../lib/format";
import { getModelMaxContext } from "./model-pricing";
import { limitBarColor } from "./resource-format";

const CHART_HEIGHT = 60;
const CHART_WIDTH = 600;

export const costOf = (t: UsageTotals) => (t.costUsd === null ? "unpriced" : formatCost(t.costUsd));

export function TrendChart({ days }: { days: UsageReport["byDay"] }) {
  if (days.length === 0) {
    return <p className="text-xs text-text-muted">No usage in this range</p>;
  }
  const maxCost = Math.max(...days.map((d) => d.costUsd ?? 0), 0.001);
  const barWidth = Math.max(4, Math.min(16, (CHART_WIDTH - days.length * 2) / days.length));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-secondary p-4">
      <svg
        width={days.length * (barWidth + 2)}
        height={CHART_HEIGHT + 20}
        className="block"
        role="img"
        aria-label="Daily cost"
      >
        {days.map((d, i) => {
          const barHeight = ((d.costUsd ?? 0) / maxCost) * CHART_HEIGHT;
          const x = i * (barWidth + 2);
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={CHART_HEIGHT - barHeight}
                width={barWidth}
                height={barHeight}
                rx={2}
                className="fill-accent"
                opacity={0.8}
              >
                <title>{`${d.date}: ${formatCost(d.costUsd ?? 0)}`}</title>
              </rect>
              {i % 5 === 0 && (
                <text x={x} y={CHART_HEIGHT + 14} className="fill-text-muted text-[8px]">
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

export function ModelRows({ models }: { models: UsageReport["byModel"] }) {
  if (models.length === 0) return <p className="text-xs text-text-muted">No token data yet</p>;
  const maxTokens = models[0]?.totalTokens || 1;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-secondary p-4">
      {models.map((m) => {
        const maxContext = getModelMaxContext(m.model);
        return (
          <div key={`${m.provider}/${m.model}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-text-primary">{m.model}</span>
                <span className="text-[10px] text-text-muted">{m.provider}</span>
                {maxContext && (
                  <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[9px] tabular-nums text-text-muted">
                    {formatTokens(maxContext)} ctx
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="text-text-muted">
                  {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)} out
                </span>
                <span className="w-16 text-right font-medium text-text-primary">{costOf(m)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(m.totalTokens / maxTokens) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right text-[10px] tabular-nums text-text-muted">
                {m.records} req{m.records !== 1 ? "s" : ""}
              </span>
            </div>
            {m.listPrice && (
              <p className="text-[10px] text-text-muted">
                ${m.listPrice.input.toFixed(2)}/M in, ${m.listPrice.output.toFixed(2)}/M out
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SessionTable({
  sessions,
  showProject,
}: {
  sessions: UsageReport["bySession"];
  showProject: boolean;
}) {
  if (sessions.length === 0) {
    return <p className="text-xs text-text-muted">No session data yet</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-bg-tertiary text-text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Session</th>
            <th className="px-3 py-2 text-left font-medium">CLI</th>
            {showProject && <th className="px-3 py-2 text-left font-medium">Project</th>}
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sessions.map((s) => (
            <tr key={s.session} className="bg-bg-secondary text-text-secondary">
              <td className="max-w-[240px] truncate px-3 py-2 text-text-primary">
                {s.label ?? s.session.slice(0, 8)}
              </td>
              <td className="px-3 py-2">{s.cli}</td>
              {showProject && <td className="px-3 py-2">{s.projectName}</td>}
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(s.totalTokens)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{costOf(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LimitInput({ cli, limitUsd }: { cli: string; limitUsd: number | null }) {
  const setLimit = useSetUsageLimit();
  const [value, setValue] = useState(limitUsd === null ? "" : String(limitUsd));

  const save = () => {
    const next = Number(value);
    const limit = value.trim() && next > 0 ? next : null;
    if (limit !== limitUsd) setLimit.mutate({ cli, limitUsd: limit });
  };

  return (
    <Input
      type="number"
      min="0"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="No limit"
      aria-label={`Monthly limit for ${cli} in USD`}
      className="h-6 w-20 px-1.5 py-0.5 text-right text-xs tabular-nums"
    />
  );
}

function CliLimitRow({ row }: { row: UsageLimit }) {
  const percent = row.limitUsd ? (row.spentUsd / row.limitUsd) * 100 : null;
  return (
    <div className="space-y-1 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium text-text-primary">{row.cli}</span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span className="text-text-secondary">{formatCost(row.spentUsd)}</span>
          <span className="text-text-muted">of $</span>
          <LimitInput cli={row.cli} limitUsd={row.limitUsd} />
        </span>
      </div>
      {percent !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={cn("h-full rounded-full", limitBarColor(percent))}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Spent this calendar month per CLI, for every project; a limit warns at 80 and 100% */
export function CliLimits() {
  const { data: rows } = useUsageLimits();
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-text-muted">No spend this month</p>;
  }
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
      {rows.map((row) => (
        <CliLimitRow key={row.cli} row={row} />
      ))}
    </div>
  );
}
