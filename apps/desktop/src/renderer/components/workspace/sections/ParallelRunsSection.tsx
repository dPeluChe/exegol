import type { ParallelRun } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Layers } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { trpcInvoke } from "../../../lib/trpc-client";
import { EmptyState } from "../../common/EmptyState";
import { ParallelRunComparator } from "./ParallelRunComparator";

export function ParallelRunsSection() {
  const { projectId } = useProjectContext();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["parallelRuns", projectId],
    queryFn: () => trpcInvoke<ParallelRun[]>("agents.listParallelRuns", { projectId }),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });

  if (activeRunId) {
    return <ParallelRunComparator runId={activeRunId} onBack={() => setActiveRunId(null)} />;
  }

  if (isLoading) {
    return null;
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-6 w-6 text-text-muted" />}
        title="No parallel runs yet"
        description="Cmd+Shift+N to launch agents in parallel and pick a winner."
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <h2 className="mb-3 text-[12px] font-semibold text-text-primary">Parallel Runs</h2>
      <ul className="flex flex-col gap-1.5">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => setActiveRunId(run.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-left transition-colors hover:border-accent/40"
            >
              <Layers className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-text-primary">
                  {run.taskDescription}
                </p>
                <p className="text-[10px] text-text-muted">
                  {run.cliTypes.join(" · ")} ·{" "}
                  <span className={cn("font-medium", statusColor(run.status))}>{run.status}</span>
                  {run.promotedAgentId && " · promoted"}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusColor(status: ParallelRun["status"]): string {
  switch (status) {
    case "completed":
      return "text-success";
    case "failed":
      return "text-error";
    case "cancelled":
      return "text-text-muted";
    default:
      return "text-accent";
  }
}
