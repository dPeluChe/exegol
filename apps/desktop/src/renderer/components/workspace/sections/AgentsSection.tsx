import { useEffect, useRef } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { dispatchRefitTerminals } from "../../../lib/dispatch-refit";
import { selectActiveTabId, selectTabs, useWorkspaceStore } from "../../../stores/workspace";
import { WorkspaceLayout } from "../WorkspaceLayout";
import { WorkspaceTabBar } from "../WorkspaceTabBar";

// ─── All Tabs Layout (keep terminals alive across tab switches) ──────────────

function AllTabsLayout() {
  const tabs = useWorkspaceStore(selectTabs);
  const activeTabId = useWorkspaceStore(selectActiveTabId);
  const ensureDefaultTab = useWorkspaceStore((s) => s.ensureDefaultTab);
  const prevActiveTabId = useRef(activeTabId);

  // Force xterm.js re-fit when switching workspace tabs
  useEffect(() => {
    if (activeTabId !== prevActiveTabId.current) {
      prevActiveTabId.current = activeTabId;
      dispatchRefitTerminals();
    }
  }, [activeTabId]);

  // Ensure at least one tab exists (moved from render body to effect)
  useEffect(() => {
    if (tabs.length === 0) ensureDefaultTab();
  }, [tabs.length, ensureDefaultTab]);

  if (tabs.length === 0) return null;

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
