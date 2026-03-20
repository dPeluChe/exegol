import { Cpu } from "lucide-react";
import { useEffect, useRef } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useMountEffect } from "../../../hooks/use-mount-effect";
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

// ─── All Tabs Layout (keep terminals alive across tab switches) ──────────────

function AllTabsLayout() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const prevActiveTabId = useRef(activeTabId);

  // Force xterm.js re-fit when switching workspace tabs
  useEffect(() => {
    if (activeTabId !== prevActiveTabId.current) {
      prevActiveTabId.current = activeTabId;
      // Dispatch custom event that TerminalInstance listens to for targeted refit
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("exegol:refit-terminals"));
      });
    }
  }, [activeTabId]);

  if (tabs.length === 0) return <EmptyWorkspace />;

  return (
    <>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={tab.id === activeTabId ? "h-full" : "invisible absolute inset-0"}
        >
          <WorkspaceLayout layout={tab.layout} tabId={tab.id} />
        </div>
      ))}
    </>
  );
}

// ─── Agents Section ─────────────────────────────────────────────────────────

export function AgentsSection() {
  const { projectId } = useProjectContext();
  const ensureDefaultTab = useWorkspaceStore((s) => s.ensureDefaultTab);

  // Ensure at least one tab exists on mount (Rule 4: mount effect for setup)
  useMountEffect(() => {
    ensureDefaultTab();
  });

  if (!projectId) return null;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceTabBar />
      <div className="relative flex-1 overflow-hidden">
        <AllTabsLayout />
      </div>
    </div>
  );
}
