import { Button, cn, Input, ScrollArea } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpFromLine,
  Check,
  GitBranch,
  History,
  Minus,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { DiffSection } from "./sections/DiffSection";
import { OplogSection } from "./sections/OplogSection";

type GitView = "changes" | "diff" | "oplog";

interface FileStatus {
  status: string;
  staged: boolean;
  path: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useGitStatus(projectId: string | undefined, pathOverride?: string) {
  return useQuery({
    queryKey: ["git", "status", pathOverride || projectId],
    queryFn: () => trpcInvoke<FileStatus[]>("diff.status", { projectId, pathOverride }),
    enabled: !!projectId,
    refetchInterval: 5_000,
  });
}

function useGitBranch(projectId: string | undefined, pathOverride?: string) {
  return useQuery({
    queryKey: ["git", "branch", pathOverride || projectId],
    queryFn: () => trpcInvoke<string>("diff.branch", { projectId, pathOverride }),
    enabled: !!projectId,
    staleTime: 10_000,
  });
}

// ─── Status icons ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-yellow-400" },
  A: { label: "Added", color: "text-green-400" },
  D: { label: "Deleted", color: "text-red-400" },
  R: { label: "Renamed", color: "text-blue-400" },
  C: { label: "Copied", color: "text-blue-400" },
  "?": { label: "Untracked", color: "text-zinc-400" },
  U: { label: "Conflict", color: "text-red-500" },
};

// ─── Changes View ───────────────────────────────────────────────────────────

function ChangesView({ projectId, overridePath }: { projectId: string; overridePath?: string }) {
  const queryClient = useQueryClient();
  const { data: files, isLoading } = useGitStatus(projectId, overridePath);
  const { data: branch } = useGitBranch(projectId, overridePath);
  const [commitMsg, setCommitMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const staged = files?.filter((f) => f.staged) ?? [];
  const unstaged = files?.filter((f) => !f.staged) ?? [];

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["git"] });
  }, [queryClient]);

  const stageMutation = useMutation({
    mutationFn: (fileList?: string[]) =>
      trpcMutate("diff.stage", { projectId, files: fileList, pathOverride: overridePath }),
    onSuccess: invalidate,
  });

  const unstageMutation = useMutation({
    mutationFn: (fileList?: string[]) =>
      trpcMutate("diff.unstage", { projectId, files: fileList, pathOverride: overridePath }),
    onSuccess: invalidate,
  });

  const commitMutation = useMutation({
    mutationFn: (opts?: { stageAll?: boolean }) =>
      trpcMutate<{ output: string }>("diff.commit", {
        projectId,
        message: commitMsg,
        pathOverride: overridePath,
        stageAll: opts?.stageAll,
      }),
    onSuccess: (result) => {
      setCommitMsg("");
      setResultMsg(result.output || "Committed successfully");
      invalidate();
    },
    onError: (err) => {
      setResultMsg(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const handlePush = async () => {
    setPushing(true);
    setResultMsg(null);
    try {
      const result = await trpcMutate<{ output: string }>("diff.push", {
        projectId,
        pathOverride: overridePath,
      });
      setResultMsg(result.output || "Pushed successfully");
    } catch (err) {
      setResultMsg(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushing(false);
      invalidate();
    }
  };

  if (isLoading) {
    return <p className="p-4 text-xs text-text-muted">Loading git status...</p>;
  }

  const totalChanges = (files ?? []).length;

  return (
    <div className="flex h-full flex-col">
      {/* Branch + actions bar */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium text-text-primary">{branch ?? "..."}</span>
        <span className="text-[9px] text-text-muted">{totalChanges} changes</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => invalidate()}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Staged files */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Staged ({staged.length})
              </span>
              {staged.length > 0 && (
                <button
                  type="button"
                  onClick={() => unstageMutation.mutate(undefined)}
                  className="text-[9px] text-text-muted hover:text-text-secondary"
                >
                  Unstage all
                </button>
              )}
            </div>
            {staged.length === 0 ? (
              <p className="py-1 text-[9px] italic text-text-muted">No staged files</p>
            ) : (
              <div className="space-y-0.5">
                {staged.map((f) => (
                  <FileRow
                    key={`s-${f.path}`}
                    file={f}
                    onToggle={() => unstageMutation.mutate([f.path])}
                    toggleIcon={Minus}
                    toggleTitle="Unstage"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Unstaged files */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Changes ({unstaged.length})
              </span>
              {unstaged.length > 0 && (
                <button
                  type="button"
                  onClick={() => stageMutation.mutate(undefined)}
                  className="text-[9px] text-text-muted hover:text-text-secondary"
                >
                  Stage all
                </button>
              )}
            </div>
            {unstaged.length === 0 ? (
              <p className="py-1 text-[9px] italic text-text-muted">Working tree clean</p>
            ) : (
              <div className="space-y-0.5">
                {unstaged.map((f) => (
                  <FileRow
                    key={`u-${f.path}`}
                    file={f}
                    onToggle={() => stageMutation.mutate([f.path])}
                    toggleIcon={Plus}
                    toggleTitle="Stage"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Commit + Push bar */}
      <div className="border-t border-border bg-bg-secondary p-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && commitMsg.trim() && totalChanges > 0) {
                commitMutation.mutate({ stageAll: staged.length === 0 });
              }
            }}
            placeholder="Commit message..."
            className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
          />
          <Button
            type="button"
            onClick={() => commitMutation.mutate({ stageAll: staged.length === 0 })}
            disabled={!commitMsg.trim() || totalChanges === 0 || commitMutation.isPending}
            className="h-7 gap-1 px-2 text-[10px]"
          >
            <Check className="h-3 w-3" />
            {commitMutation.isPending ? "..." : staged.length > 0 ? "Commit" : "Commit All"}
          </Button>
          <Button
            type="button"
            onClick={handlePush}
            disabled={pushing}
            className="h-7 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary hover:text-text-primary"
          >
            <Upload className="h-3 w-3" />
            {pushing ? "..." : "Push"}
          </Button>
        </div>
        {resultMsg && (
          <p
            className={cn(
              "text-[9px]",
              resultMsg.includes("failed") ? "text-red-400" : "text-green-400",
            )}
          >
            {resultMsg}
          </p>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  onToggle,
  toggleIcon: ToggleIcon,
  toggleTitle,
}: {
  file: FileStatus;
  onToggle: () => void;
  toggleIcon: typeof Plus;
  toggleTitle: string;
}) {
  const info = STATUS_LABELS[file.status] ?? { label: file.status, color: "text-text-muted" };
  return (
    <div className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-white/5">
      <span className={cn("w-2 text-center text-[9px] font-bold", info.color)}>{file.status}</span>
      <span className="flex-1 truncate text-[10px] text-text-secondary">{file.path}</span>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
        title={toggleTitle}
      >
        <ToggleIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Main GitPane ───────────────────────────────────────────────────────────

export function GitPane({ overridePath }: { overridePath?: string } = {}) {
  const { projectId } = useProjectContext();
  const [view, setView] = useState<GitView>("changes");

  return (
    <div className="flex h-full flex-col">
      {/* Toggle bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-3">
        {[
          { id: "changes" as const, label: "Changes", icon: ArrowUpFromLine },
          { id: "diff" as const, label: "Diff", icon: GitBranch },
          { id: "oplog" as const, label: "Agent Ops", icon: History },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
              view === id
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "changes" && projectId && (
          <ChangesView projectId={projectId} overridePath={overridePath} />
        )}
        {view === "diff" && <DiffSection />}
        {view === "oplog" && <OplogSection />}
      </div>
    </div>
  );
}
