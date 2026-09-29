import type { PipelineRun } from "@exegol/shared";
import { CheckCircle, Loader2, Pause, Trash2, XCircle } from "lucide-react";
import { useCancelPipelineRun, useDeletePipelineRun } from "../../../../hooks/use-trpc-pipeline";

function RunStatusIcon({ status }: { status: PipelineRun["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-green-400" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />;
    case "paused":
      return <Pause className="h-3.5 w-3.5 text-yellow-400" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-text-muted/30" />;
  }
}

export function PipelineRunList({
  runs,
  onOpen,
}: {
  runs: PipelineRun[] | undefined;
  onOpen: (runId: string) => void;
}) {
  const deleteRun = useDeletePipelineRun();
  const cancelRun = useCancelPipelineRun();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Runs</h4>
      </div>
      <div className="space-y-0.5 px-1">
        {(!runs || runs.length === 0) && (
          <p className="px-3 py-4 text-center text-[10px] text-text-muted">
            No pipeline runs yet. Select a template and start one above.
          </p>
        )}
        {runs?.map((r) => (
          <div
            key={r.id}
            className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5"
          >
            <button
              type="button"
              className="flex flex-1 items-center gap-2 text-left"
              onClick={() => onOpen(r.id)}
            >
              <RunStatusIcon status={r.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-text-primary">
                  {r.originalTask || "Untitled"}
                </p>
                <p className="text-[9px] text-text-muted">
                  Step {r.currentStepIndex + 1} of {r.stepResults.length || "?"} — {r.status}
                  {r.iterationCount > 0 && ` (iter ${r.iterationCount})`}
                </p>
              </div>
            </button>
            <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
              {(r.status === "running" || r.status === "paused") && (
                <button
                  type="button"
                  onClick={() => cancelRun.mutate(r.id)}
                  className="text-text-muted hover:text-red-400"
                >
                  <XCircle className="h-3 w-3" />
                </button>
              )}
              {r.status !== "running" && (
                <button
                  type="button"
                  onClick={() => deleteRun.mutate(r.id)}
                  className="text-text-muted hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
