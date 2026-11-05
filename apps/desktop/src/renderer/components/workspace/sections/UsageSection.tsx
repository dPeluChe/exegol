import type { UsageReport } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useTokenScan, useUsage } from "../../../hooks/use-trpc";
import { formatTimeAgo, formatTokens } from "../../../lib/format";
import { FilterChip } from "../../common/FilterChip";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { BudgetsCard } from "./BudgetsCard";
import { PriceTableEditor } from "./PriceTableEditor";
import { CliLimits, costOf, ModelRows, SessionTable, TrendChart } from "./usage-parts";

type Scope = "global" | "project";

const RANGES = [7, 30, 90];

const percent = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-text-muted">{detail}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ProjectRows({ rows }: { rows: UsageReport["byProject"] }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
      {rows.map((p) => (
        <div key={p.projectId} className="flex items-center justify-between px-3 py-2 text-xs">
          <span className="truncate font-medium text-text-primary">{p.projectName}</span>
          <span className="flex shrink-0 items-center gap-3 tabular-nums">
            <span className="text-text-muted">{formatTokens(p.totalTokens)}</span>
            <span className="w-16 text-right font-medium text-text-primary">{costOf(p)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function UsageSection() {
  const { project } = useProjectContext();
  const [scope, setScope] = useState<Scope>("project");
  const [days, setDays] = useState(30);
  const projectId = scope === "project" ? (project?.id ?? null) : null;
  const { data: report } = useUsage(projectId, days);
  const scan = useTokenScan();
  const totals = report?.totals;

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          tabs={[
            { id: "global", label: "Global" },
            { id: "project", label: project?.name ?? "Project" },
          ]}
          active={scope}
          onChange={setScope}
          label="Usage scope"
        />
        <div className="flex items-center gap-2">
          {report?.lastImportAt && (
            <span className="text-[10px] text-text-muted">
              Updated {formatTimeAgo(report.lastImportAt)}
            </span>
          )}
          {RANGES.map((d) => (
            <FilterChip key={d} active={days === d} onClick={() => setDays(d)}>
              {d}d
            </FilterChip>
          ))}
          {project && (
            <Button
              type="button"
              onClick={() => scan.mutate({ projectId: project.id })}
              disabled={scan.isPending}
              className={cn("gap-1.5 text-xs", scan.isPending && "opacity-60")}
            >
              <RefreshCw className={cn("h-3 w-3", scan.isPending && "animate-spin")} />
              {scan.isPending ? "Scanning..." : "Scan Logs"}
            </Button>
          )}
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Cost" value={costOf(totals)} detail={`Last ${days} days`} />
          <SummaryCard
            label="Tokens"
            value={formatTokens(totals.totalTokens)}
            detail={`${formatTokens(totals.inputTokens)} in, ${formatTokens(totals.outputTokens)} out`}
          />
          <SummaryCard
            label="Cache hit rate"
            value={percent(totals.cacheHitRate)}
            detail={`${formatTokens(totals.cacheReadTokens)} read`}
          />
          <SummaryCard label="Tool calls" value={String(totals.toolCalls)} />
        </div>
      )}

      {totals && totals.unpriced.records > 0 && (
        <p className="text-xs text-text-muted">
          {formatTokens(totals.unpriced.tokens)} tokens from models with no price are left out of
          the cost.
        </p>
      )}

      {report && (
        <Block title="Daily cost">
          <TrendChart days={report.byDay} />
        </Block>
      )}

      {scope === "global" && report && report.byProject.length > 0 && (
        <Block title="By project">
          <ProjectRows rows={report.byProject} />
        </Block>
      )}

      <Block title="By CLI, this month">
        <CliLimits />
      </Block>

      {scope === "project" && project && (
        <Block title="Budgets">
          <BudgetsCard projectId={project.id} />
        </Block>
      )}

      {report && (
        <>
          <Block title="By model">
            <ModelRows models={report.byModel} />
          </Block>
          <Block title="By session">
            <SessionTable sessions={report.bySession} showProject={scope === "global"} />
          </Block>
        </>
      )}

      <Block title="Provider pricing">
        <PriceTableEditor />
      </Block>

      {scan.isSuccess && (
        <p className="text-xs text-text-muted">
          Imported {scan.data.imported} entries from local CLI logs.
          {scan.data.skipped > 0 && ` (${scan.data.skipped} duplicates skipped)`}
        </p>
      )}
    </div>
  );
}
