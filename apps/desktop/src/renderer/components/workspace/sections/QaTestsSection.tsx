import type { QaTest, QaTestRun } from "@exegol/shared";
import { ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { selectPanes, useWorkspaceStore } from "../../../stores/workspace";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: QaTest["lastStatus"] }) {
  if (status === "passed")
    return (
      <span className="flex items-center gap-0.5 text-[9px] text-green-400">
        <CheckCircle className="h-2.5 w-2.5" />
        passed
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex items-center gap-0.5 text-[9px] text-red-400">
        <XCircle className="h-2.5 w-2.5" />
        failed
      </span>
    );
  return <span className="text-[9px] text-text-muted">{status}</span>;
}

// ─── Run details row ────────────────────────────────────────────────────────

function RunDetails({ testId }: { testId: string }) {
  const { data: run } = useQuery<QaTestRun | null>({
    queryKey: ["qaLatestRun", testId],
    queryFn: () => trpcInvoke<QaTestRun | null>("qaTests.getLatestRun", { testId }),
    staleTime: 10_000,
  });

  if (!run) return null;

  let steps: { actionIndex: number; passed: boolean; error?: string }[] = [];
  try {
    steps = JSON.parse(run.stepResults);
  } catch {
    /* ignore */
  }
  const failed = steps.filter((s) => !s.passed);

  return (
    <div className="mt-1.5 rounded border border-border bg-bg-primary/60 px-2 py-1.5 text-[9px]">
      <div className="flex items-center gap-2 text-text-muted">
        <span>{run.durationMs}ms</span>
        <span>{steps.length} steps</span>
        {failed.length > 0 && <span className="text-red-400">{failed.length} failed</span>}
      </div>
      {failed.map((s) => (
        <p key={s.actionIndex} className="mt-0.5 truncate text-red-400">
          Step {s.actionIndex + 1}: {s.error}
        </p>
      ))}
    </div>
  );
}

// ─── Test card ──────────────────────────────────────────────────────────────

function TestCard({
  test,
  onRun,
  onDelete,
}: {
  test: QaTest;
  onRun: (test: QaTest) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-text-muted hover:text-text-primary"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-medium text-text-primary">{test.name}</span>
            <StatusBadge status={test.lastStatus} />
          </div>
          <p className="truncate text-[9px] text-text-muted">
            {test.actionCount} actions · {new URL(test.startUrl).host}
            {test.lastRunAt && ` · ${formatDate(test.lastRunAt)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {confirmDelete ? (
            <>
              <span className="text-[9px] text-red-400">Delete?</span>
              <button
                type="button"
                onClick={() => onDelete(test.id)}
                className="rounded px-1.5 py-0.5 text-[9px] text-red-400 hover:bg-red-500/10"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onRun(test)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-green-400 hover:bg-green-500/10"
                title="Run test in active browser pane"
              >
                <Play className="h-2.5 w-2.5" />
                Run
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded p-0.5 text-text-muted/50 hover:bg-red-500/10 hover:text-red-400"
                title="Delete test"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 px-3 pb-2">
          <p className="mt-1.5 break-all font-mono text-[9px] text-text-muted">{test.startUrl}</p>
          <RunDetails testId={test.id} />
        </div>
      )}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

export function QaTestsSection() {
  const { project } = useProjectContext();
  const projectId = project?.id;
  const [runError, setRunError] = useState<string | null>(null);

  const {
    data: tests = [],
    isLoading,
    refetch,
  } = useQuery<QaTest[]>({
    queryKey: ["qaTests", projectId],
    queryFn: () => trpcInvoke<QaTest[]>("qaTests.list", { projectId: projectId ?? "" }),
    enabled: !!projectId,
    staleTime: 10_000,
  });

  const handleRun = (test: QaTest) => {
    setRunError(null);
    let actions: unknown[] = [];
    try {
      actions = JSON.parse(test.actions);
    } catch {
      setRunError(`"${test.name}" has corrupted action data and can't be run.`);
      return;
    }
    if (!actions.length) {
      setRunError(`"${test.name}" has no recorded actions.`);
      return;
    }
    // Check that a browser pane exists before switching away
    const ws = useWorkspaceStore.getState();
    const panes = selectPanes(ws);
    const hasBrowserPane = Object.values(panes).some((p) => p?.type === "browser");
    if (!hasBrowserPane) {
      setRunError("No Browser pane open. Add one from the workspace layout, then try again.");
      return;
    }
    window.dispatchEvent(
      new CustomEvent("exegol:qa-run-test", {
        detail: { testId: test.id, startUrl: test.startUrl, actions },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
    );
  };

  const handleDelete = async (id: string) => {
    await trpcMutate("qaTests.delete", { id });
    refetch();
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        No project selected
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-xs font-semibold text-text-primary">QA Tests</span>
          {tests.length > 0 && (
            <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] text-text-muted">
              {tests.length}
            </span>
          )}
        </div>
        <p className="text-[10px] text-text-muted">Record in Browser pane → Save Test</p>
      </div>

      {/* Run error banner */}
      {runError && (
        <div className="flex shrink-0 items-center justify-between border-b border-red-500/30 bg-red-500/5 px-4 py-1.5">
          <p className="text-[10px] text-red-400">{runError}</p>
          <button
            type="button"
            onClick={() => setRunError(null)}
            className="text-[9px] text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {isLoading && <p className="text-center text-xs text-text-muted">Loading...</p>}

          {!isLoading && tests.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <ClipboardList className="h-8 w-8 text-text-muted/30" />
              <div className="text-center">
                <p className="text-xs font-medium text-text-primary">No QA tests yet</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  Open a Browser pane, click the Bug icon to record a flow, then Save Test.
                </p>
              </div>
            </div>
          )}

          {tests.map((test) => (
            <TestCard key={test.id} test={test} onRun={handleRun} onDelete={handleDelete} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
