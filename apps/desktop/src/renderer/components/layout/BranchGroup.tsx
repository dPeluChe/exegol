import type { Worktree } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { FolderOpen, GitBranch, Trash2 } from "lucide-react";
import { useState } from "react";
import { trpcMutate } from "../../lib/trpc-client";
import type { AgentState } from "../../stores/agents";
import { findFirstPaneId, useWorkspaceStore } from "../../stores/workspace";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { AgentMiniCard } from "./AgentMiniCard";

export function BranchGroup({
  branchName,
  agents,
  isWorktree,
  worktree,
  projectId,
  onWorktreeDeleted,
}: {
  branchName: string;
  agents: AgentState[];
  isWorktree: boolean;
  worktree?: Worktree;
  projectId: string;
  onWorktreeDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleViewChanges = () => {
    if (!worktree) return;
    window.dispatchEvent(
      new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
    );
    const store = useWorkspaceStore.getState();
    const activeTab = store.getActiveTab();
    if (!activeTab) return;
    const layout = activeTab.layout;
    const paneId = findFirstPaneId(layout);
    if (paneId) store.updatePane(paneId, { type: "files", filePath: worktree.path });
  };

  const handleDeleteConfirmed = async () => {
    if (!worktree || deleting) return;
    setDeleting(true);
    try {
      await trpcMutate("projects.deleteWorktree", {
        worktreeId: worktree.id,
        projectId,
        force: true,
      });
      onWorktreeDeleted?.();
    } catch {
      /* */
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-0.5">
      <div className="group/branch flex items-center gap-1.5 px-1 py-0.5 text-[9px] text-text-muted">
        <GitBranch
          className={cn(
            "h-2.5 w-2.5 shrink-0",
            isWorktree ? "text-accent/60" : "text-text-muted/50",
          )}
        />
        <span className="flex-1 truncate font-medium">{branchName}</span>
        {isWorktree && worktree && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/branch:opacity-100">
            <button
              type="button"
              onClick={handleViewChanges}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
              title="Browse files"
            >
              <FolderOpen className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
                );
                const store = useWorkspaceStore.getState();
                const activeTab = store.getActiveTab();
                if (activeTab) {
                  const paneId = findFirstPaneId(activeTab.layout);
                  if (paneId && worktree) {
                    store.updatePane(paneId, { type: "git", filePath: worktree.path });
                  }
                }
              }}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-accent"
              title="Git status"
            >
              <GitBranch className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-red-400/20 hover:text-red-400"
              title="Delete worktree"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        )}
      </div>
      {agents.map((agent) => (
        <AgentMiniCard key={agent.id} agent={agent} />
      ))}

      {isWorktree && worktree && (
        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title="Delete Worktree"
          description={`This will permanently delete the branch "${branchName}" and all files at:\n${worktree.path}\n\nThis action cannot be undone.`}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          variant="destructive"
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}
