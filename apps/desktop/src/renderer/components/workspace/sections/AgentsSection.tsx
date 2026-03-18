import { Cpu } from "lucide-react";
import { useEffect } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useWorkspaceStore } from "../../../stores/workspace";
import { WorkspaceLayout } from "../WorkspaceLayout";
import { WorkspaceTabBar } from "../WorkspaceTabBar";

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyWorkspace() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-secondary">
        <Cpu className="h-7 w-7 text-text-muted" />
      </div>
      <p className="text-sm text-text-muted">Create a tab to get started</p>
    </div>
  );
}

// ─── Active Tab Layout ──────────────────────────────────────────────────────

function ActiveTabLayout() {
  const activeTab = useWorkspaceStore((s) => s.getActiveTab());
  if (!activeTab) return <EmptyWorkspace />;
  return <WorkspaceLayout layout={activeTab.layout} tabId={activeTab.id} />;
}

// ─── Agents Section ─────────────────────────────────────────────────────────

export function AgentsSection() {
  const { projectId } = useProjectContext();
  const ensureDefaultTab = useWorkspaceStore((s) => s.ensureDefaultTab);

  // Ensure at least one tab exists on mount
  useEffect(() => {
    ensureDefaultTab();
  }, [ensureDefaultTab]);

  if (!projectId) return null;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceTabBar />
      <div className="flex-1 overflow-hidden">
        <ActiveTabLayout />
      </div>
    </div>
  );
}
