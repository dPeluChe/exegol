import type { PipelineRun, PipelineRunStatus, PipelineStepResult } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  CheckCircle,
  Circle,
  GitBranch,
  Loader2,
  Pause,
  Play,
  SkipForward,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import {
  useCancelPipelineRun,
  usePausePipelineRun,
  usePipelineRun,
  usePipelineTemplate,
  useResumePipelineRun,
} from "../../../../hooks/use-trpc-pipeline";
import { useAgentStore } from "../../../../stores/agents";
import { useTerminalStore } from "../../../../stores/terminals";
import { findFirstPaneId, useWorkspaceStore } from "../../../../stores/workspace";
import { TerminalInstance } from "../../../terminal/TerminalInstance";

/** Lightweight inline terminal for pipeline steps — uses TerminalInstance directly */
function PipelineTerminal({ agentId }: { agentId: string }) {
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const hasTerminal = useTerminalStore((s) => !!s.terminals[agentId]);
  useEffect(() => {
    if (!hasTerminal) createTerminal(agentId);
  }, [agentId, hasTerminal, createTerminal]);
  if (!hasTerminal) return null;
  return <TerminalInstance agentId={agentId} readOnly={false} />;
}

function StepStatusIcon({ status }: { status: PipelineStepResult["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-400" />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-accent" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-text-muted" />;
    default:
      return <Circle className="h-4 w-4 text-text-muted/40" />;
  }
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return "";
  const end = completedAt ?? Math.floor(Date.now() / 1000);
  const secs = end - startedAt;
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function RunStatusBadge({ status }: { status: PipelineRun["status"] }) {
  const colors: Record<PipelineRunStatus, string> = {
    pending: "bg-white/5 text-text-muted",
    running: "bg-accent/15 text-accent",
    paused: "bg-yellow-500/15 text-yellow-400",
    completed: "bg-green-500/15 text-green-400",
    failed: "bg-red-500/15 text-red-400",
    cancelled: "bg-white/5 text-text-muted",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", colors[status])}>
      {status}
    </span>
  );
}

export function PipelineRunView({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: run } = usePipelineRun(runId);
  const { data: template } = usePipelineTemplate(run?.templateId ?? null);
  const pauseMutation = usePausePipelineRun();
  const resumeMutation = useResumePipelineRun();
  const cancelMutation = useCancelPipelineRun();

  const navigateToTerminal = useCallback((agentId: string) => {
    // Switch to Agents section (from Pipelines sub-tab)
    window.dispatchEvent(
      new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
    );
    // Open the agent's terminal in the active pane
    const store = useWorkspaceStore.getState();
    const activeTab = store.getActiveTab();
    if (activeTab) {
      const firstPaneId = findFirstPaneId(activeTab.layout);
      if (firstPaneId) {
        store.updatePane(firstPaneId, { type: "terminal", agentId });
      }
    } else {
      // No tab — create one with the terminal
      const tabId = store.addTab("Pipeline Agent");
      const newTab = store.tabs.find((t) => t.id === tabId);
      if (newTab) {
        const paneId = findFirstPaneId(newTab.layout);
        if (paneId) {
          store.updatePane(paneId, { type: "terminal", agentId });
        }
      }
    }
    useAgentStore.getState().setFocusedAgent(agentId);
  }, []);

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-text-muted">Loading run...</p>
      </div>
    );
  }

  const steps = template?.steps ?? [];

  // Map step results by stepIndex for the latest iteration
  const resultMap = new Map<number, PipelineStepResult>();
  for (const r of run.stepResults) {
    resultMap.set(r.stepIndex, r);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {template?.name ?? "Pipeline Run"}
            </h3>
            <p className="max-w-md truncate text-[10px] text-text-muted">{run.originalTask}</p>
          </div>
          {run.worktreePath && (
            <div className="flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
              <GitBranch className="h-3 w-3 text-text-muted" />
              <span className="text-[9px] text-text-muted">
                {run.worktreePath.split("/").pop()}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {run.iterationCount > 0 && (
            <span className="text-[10px] text-text-muted">
              iter {run.iterationCount}/{run.maxIterations}
            </span>
          )}
          {run.status === "running" && (
            <button
              type="button"
              onClick={() => pauseMutation.mutate(run.id)}
              className="rounded bg-yellow-500/15 px-2 py-1 text-[10px] font-medium text-yellow-400 hover:bg-yellow-500/25"
            >
              <Pause className="inline h-3 w-3" /> Pause
            </button>
          )}
          {run.status === "paused" && (
            <button
              type="button"
              onClick={() => resumeMutation.mutate(run.id)}
              className="rounded bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/25"
            >
              <Play className="inline h-3 w-3" /> Resume
            </button>
          )}
          {(run.status === "running" || run.status === "paused") && (
            <button
              type="button"
              onClick={() => cancelMutation.mutate(run.id)}
              className="rounded bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/25"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Step Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-0">
          {steps.map((step, i) => {
            const result = resultMap.get(i);
            const isActive = run.currentStepIndex === i && run.status === "running";

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: template steps are static
              <div key={`step-${step.label}-${i}`} className="relative flex gap-3">
                {/* Vertical line */}
                {i < steps.length - 1 && (
                  <div className="absolute left-[7px] top-6 h-full w-px bg-border" />
                )}

                {/* Icon */}
                <div className="relative z-10 mt-0.5 shrink-0">
                  <StepStatusIcon status={result?.status ?? "pending"} />
                </div>

                {/* Content */}
                <div
                  className={cn(
                    "mb-4 flex-1 rounded-lg border p-3",
                    isActive ? "border-accent/30 bg-accent/5" : "border-border bg-bg-secondary",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary">{step.label}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted">
                        {step.cliType}
                      </span>
                      <span className="text-[9px] text-text-muted">{step.role}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {result?.agentId && (
                        <button
                          type="button"
                          onClick={() => navigateToTerminal(result.agentId as string)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/10 hover:text-accent"
                          title="View terminal"
                        >
                          <Terminal className="h-3 w-3" />
                          Terminal
                        </button>
                      )}
                      {result && (
                        <span className="text-[9px] text-text-muted">
                          {formatDuration(result.startedAt, result.completedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Live terminal for active step */}
                  {isActive && result?.agentId && (
                    <div className="mt-2 h-64 overflow-hidden rounded border border-border">
                      <PipelineTerminal agentId={result.agentId} />
                    </div>
                  )}

                  {/* Output summary for completed/failed steps */}
                  {!isActive && result?.outputSummary && result.status !== "pending" && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] text-text-muted hover:text-text-secondary">
                        Output
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg-primary p-2 text-[10px] text-text-secondary">
                        {result.outputSummary.slice(-500)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
