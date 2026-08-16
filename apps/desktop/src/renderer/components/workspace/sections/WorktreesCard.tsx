import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderGit2, Loader2, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";

interface FleetWorktree {
  id: string;
  path: string;
  branchName: string;
  projectId: string;
  projectName: string;
  liveAgents: number;
  exists: boolean;
  dirty: boolean;
}

/**
 * T176 — every worktree Exegol owns, in one place.
 *
 * They live under ~/.exegol/worktrees/<project>/<branch>, outside the repo, so
 * nothing in the user's own checkout hints that they exist. Without this view
 * they accumulate silently: after a few rounds the disk holds a dozen branches
 * nobody will open again.
 */
export function WorktreesCard() {
  const queryClient = useQueryClient();

  const { data: worktrees = [], isLoading } = useQuery({
    queryKey: ["allWorktrees"],
    queryFn: () => trpcInvoke<FleetWorktree[]>("projects.listAllWorktrees"),
    staleTime: 15_000,
  });

  const remove = useMutation({
    mutationFn: (wt: FleetWorktree) =>
      trpcMutate("projects.deleteWorktree", {
        worktreeId: wt.id,
        projectId: wt.projectId,
        // Dirty ones need force; the button already warned about it.
        force: wt.dirty,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["allWorktrees"] });
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
    },
  });

  const isRemoving = (id: string) => remove.isPending && remove.variables?.id === id;

  const handleDelete = useCallback(
    (wt: FleetWorktree) => {
      // In use means an agent is working there right now — deleting it would
      // pull the floor out from under a live session.
      if (wt.liveAgents > 0) return;
      if (wt.dirty && !confirm(`${wt.branchName} has uncommitted changes. Delete anyway?`)) return;
      remove.mutate(wt);
    },
    [remove],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary p-3 text-[11px] text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading worktrees…
      </div>
    );
  }

  if (worktrees.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
        <FolderGit2 className="h-3.5 w-3.5 text-text-muted" />
        Worktrees
        <span className="text-text-muted">({worktrees.length})</span>
      </div>

      <div className="flex flex-col gap-1">
        {worktrees.map((wt) => (
          <div
            key={wt.id}
            className="flex items-center gap-2 rounded border border-border/60 bg-bg-primary px-2 py-1.5 text-[11px]"
          >
            <span className="shrink-0 text-text-muted">{wt.projectName}</span>
            <code className="truncate text-text-primary" title={wt.path}>
              {wt.branchName}
            </code>

            {wt.liveAgents > 0 && (
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                in use
              </span>
            )}
            {wt.dirty && (
              <span
                className="flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500"
                title="Uncommitted changes"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                dirty
              </span>
            )}
            {!wt.exists && (
              <span className="shrink-0 text-[10px] text-text-muted" title="Directory is gone">
                missing
              </span>
            )}

            <button
              type="button"
              onClick={() => handleDelete(wt)}
              disabled={wt.liveAgents > 0 || isRemoving(wt.id)}
              title={wt.liveAgents > 0 ? "An agent is working here" : "Delete worktree"}
              className={cn(
                "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                wt.liveAgents > 0
                  ? "cursor-not-allowed text-text-muted/40"
                  : "text-text-muted hover:bg-red-400/80 hover:text-white",
              )}
            >
              {isRemoving(wt.id) ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
