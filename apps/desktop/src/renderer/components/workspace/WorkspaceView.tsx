import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { findFirstPaneId, getProjectState, useWorkspaceStore } from "../../stores/workspace";
import { ParallelSpawnModal } from "../agents/ParallelSpawnModal";
import { SpawnAgentModal } from "../agents/SpawnAgentModal";
import { LoadingSpinner } from "../common";
import { AgentsSection } from "./sections/AgentsSection";
import { type WorkspaceSection, WorkspaceTabs } from "./WorkspaceTabs";

// ─── Shortcuts for the help overlay (Cmd+/) ────────────────────────────────

const SHORTCUTS: { key: string; label: string }[] = [
  { key: "Cmd+B", label: "Toggle Sidebar" },
  { key: "Cmd+T", label: "New Tab" },
  { key: "Cmd+W", label: "Close Pane / Tab" },
  { key: "Cmd+D", label: "Split Horizontal" },
  { key: "Cmd+Shift+D", label: "Split Vertical" },
  { key: "Cmd+,", label: "Settings" },
  { key: "Cmd+K", label: "Command Palette" },
  { key: "Cmd+Shift+P", label: "Command Palette (alt)" },
  { key: "Cmd+N", label: "New Agent" },
  { key: "Cmd+Shift+N", label: "Parallel Spawn" },
  { key: "Cmd+.", label: "Stop Focused Agent" },
  { key: "Cmd+1-9", label: "Switch Tab by Number" },
  { key: "Cmd+]", label: "Next Tab" },
  { key: "Cmd+[", label: "Previous Tab" },
  { key: "Ctrl+Tab", label: "Cycle Tabs Forward" },
  { key: "Ctrl+Shift+Tab", label: "Cycle Tabs Backward" },
  { key: "Cmd+/", label: "Show This Help" },
];

// Lazy: non-default sections are only rendered on user demand.
// Each section bundles its own deps (PipelineSection pulls xterm via PipelineRunView).
const TasksSection = lazy(() =>
  import("./sections/TasksSection").then((m) => ({ default: m.TasksSection })),
);
const PromptsSkillsSection = lazy(() =>
  import("./sections/PromptsSkillsSection").then((m) => ({ default: m.PromptsSkillsSection })),
);
const MemorySection = lazy(() =>
  import("./sections/MemorySection").then((m) => ({ default: m.MemorySection })),
);
const PipelineSection = lazy(() =>
  import("./sections/PipelineSection").then((m) => ({ default: m.PipelineSection })),
);
const ParallelRunsSection = lazy(() =>
  import("./sections/ParallelRunsSection").then((m) => ({ default: m.ParallelRunsSection })),
);
const ResourcesTokensSection = lazy(() =>
  import("./sections/ResourcesTokensSection").then((m) => ({ default: m.ResourcesTokensSection })),
);
const ScoringSection = lazy(() =>
  import("./sections/ScoringSection").then((m) => ({ default: m.ScoringSection })),
);
const AgentDashboard = lazy(() =>
  import("./sections/AgentDashboard").then((m) => ({ default: m.AgentDashboard })),
);
const QaTestsSection = lazy(() =>
  import("./sections/QaTestsSection").then((m) => ({ default: m.QaTestsSection })),
);

function SectionFallback() {
  return <LoadingSpinner className="h-full" />;
}

export function WorkspaceView() {
  const { projectId } = useProjectContext();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("agents");
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [spawnInitialTask, setSpawnInitialTask] = useState<string | undefined>(undefined);
  const [spawnInitialCliType, setSpawnInitialCliType] = useState<string | undefined>(undefined);
  const [showParallelModal, setShowParallelModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isAgents = activeSection === "agents";
  const prevIsAgents = useRef(isAgents);

  // Listen for section switch events from sidebar (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section as WorkspaceSection;
      if (section) setActiveSection(section);
    };
    window.addEventListener("exegol:switch-section", handler);
    return () => window.removeEventListener("exegol:switch-section", handler);
  });

  // Listen for Cmd+N spawn-agent hotkey OR T106 "New agent with same task"
  // (which passes detail.taskDescription + detail.cliType for pre-fill).
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { taskDescription?: string; cliType?: string }
        | undefined;
      setSpawnInitialTask(detail?.taskDescription);
      setSpawnInitialCliType(detail?.cliType);
      setShowSpawnModal(true);
    };
    window.addEventListener("exegol:spawn-agent", handler);
    return () => window.removeEventListener("exegol:spawn-agent", handler);
  });

  // T107 comparator "Open" → focus an existing agent's pane (or create one
  // in the active tab if none exists).
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      const agentId = detail?.agentId;
      if (!agentId) return;
      focusAgentPane(agentId);
    };
    window.addEventListener("exegol:focus-agent", handler);
    return () => window.removeEventListener("exegol:focus-agent", handler);
  });

  // T106 stop-reason "View diff" → repoint the focused (or first) pane of
  // the active tab to the git view scoped to that agent's worktree.
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      const agentId = detail?.agentId;
      if (!agentId) return;
      void openDiffForAgent(agentId);
    };
    window.addEventListener("exegol:view-diff", handler);
    return () => window.removeEventListener("exegol:view-diff", handler);
  });

  // Listen for Cmd+Shift+N parallel-spawn hotkey (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = () => setShowParallelModal(true);
    window.addEventListener("exegol:spawn-parallel", handler);
    return () => window.removeEventListener("exegol:spawn-parallel", handler);
  });

  // Listen for Cmd+/ shortcut help overlay (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = () => setShowShortcuts((prev) => !prev);
    window.addEventListener("exegol:show-shortcuts", handler);
    return () => window.removeEventListener("exegol:show-shortcuts", handler);
  });

  // Force xterm.js terminals to re-fit when switching back to Agents tab
  useEffect(() => {
    if (isAgents && !prevIsAgents.current) {
      dispatchRefitTerminals();
    }
    prevIsAgents.current = isAgents;
  }, [isAgents]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Select a project to get started</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <WorkspaceTabs activeSection={activeSection} onSectionChange={setActiveSection} />

      <div className="relative flex-1 overflow-hidden">
        {/* Agents: always mounted. When hidden, keep in DOM but invisible.
            Dispatch resize event when becoming visible to trigger xterm.js fit() */}
        <div className={isAgents ? "absolute inset-0" : "invisible absolute inset-0"}>
          <AgentsSection />
        </div>

        {/* Other sections: conditionally rendered + lazy loaded (no terminal state to preserve) */}
        {activeSection !== "agents" && (
          <Suspense fallback={<SectionFallback />}>
            {activeSection === "tasks" && <TasksSection />}
            {activeSection === "prompts-skills" && <PromptsSkillsSection />}
            {activeSection === "memory" && <MemorySection />}
            {activeSection === "pipelines" && <PipelineSection />}
            {activeSection === "parallel-runs" && <ParallelRunsSection />}
            {activeSection === "qa-tests" && <QaTestsSection />}
            {activeSection === "agent-dashboard" && <AgentDashboard />}
            {activeSection === "resources-tokens" && <ResourcesTokensSection />}
            {activeSection === "scoring" && <ScoringSection />}
          </Suspense>
        )}
      </div>

      {showSpawnModal && projectId && (
        <SpawnAgentModal
          projectId={projectId}
          initialTask={spawnInitialTask}
          initialCliType={spawnInitialCliType}
          onClose={() => {
            setShowSpawnModal(false);
            setSpawnInitialTask(undefined);
            setSpawnInitialCliType(undefined);
          }}
        />
      )}

      {showParallelModal && projectId && (
        <ParallelSpawnModal projectId={projectId} onClose={() => setShowParallelModal(false)} />
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowShortcuts(false)}
            role="none"
          />
          <div className="relative z-10 w-[400px] rounded-xl border border-border bg-bg-primary p-4 shadow-2xl">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
            <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
              {SHORTCUTS.map((s) => (
                <React.Fragment key={s.key}>
                  <span className="text-text-muted">{s.label}</span>
                  <kbd className="text-right font-mono text-text-secondary">{s.key}</kbd>
                </React.Fragment>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowShortcuts(false)}
              className="mt-3 w-full rounded-lg bg-bg-secondary py-1.5 text-[11px] text-text-muted hover:bg-white/5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Find the (tab, pane) that hosts a terminal for `agentId` and make it the
 * active focus. Falls back to creating a terminal pane in the active tab if
 * no pane currently references the agent.
 */
function focusAgentPane(agentId: string): void {
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();

  for (const tab of pw.tabs) {
    for (const [paneId, pane] of Object.entries(pw.panes)) {
      if (pane.type === "terminal" && pane.agentId === agentId) {
        const tabContainsPane = tabIncludesPane(tab.layout, paneId);
        if (tabContainsPane) {
          ws.setActiveTab(tab.id);
          ws.setFocusedPane(paneId);
          useAgentStore.getState().setFocusedAgent(agentId);
          window.dispatchEvent(
            new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
          );
          return;
        }
      }
    }
  }

  const activeTab = pw.tabs.find((t) => t.id === pw.activeTabId);
  if (activeTab) {
    const paneId = findFirstPaneId(activeTab.layout);
    if (paneId) {
      ws.updatePane(paneId, { type: "terminal", agentId });
      ws.setFocusedPane(paneId);
      useAgentStore.getState().setFocusedAgent(agentId);
    }
  }
  window.dispatchEvent(new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }));
}

function tabIncludesPane(
  node: { type: "pane"; paneId: string } | { type: "split"; children: unknown[] },
  paneId: string,
): boolean {
  if (node.type === "pane") return node.paneId === paneId;
  for (const child of node.children) {
    if (tabIncludesPane(child as Parameters<typeof tabIncludesPane>[0], paneId)) return true;
  }
  return false;
}

/**
 * Find the agent's worktree on the main process side, then update the
 * currently focused (or first) pane in the active tab to the git view
 * scoped to that worktree.
 */
async function openDiffForAgent(agentId: string): Promise<void> {
  let worktreePath: string | undefined;
  try {
    const path = await trpcInvoke<string | null>("agents.getWorktreePath", { agentId });
    worktreePath = path ?? undefined;
  } catch {
    /* no worktree row — fall back to project root */
  }
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();
  const activeTab = pw.tabs.find((t) => t.id === pw.activeTabId);
  if (!activeTab) return;
  const paneId = ws.focusedPaneId ?? findFirstPaneId(activeTab.layout);
  if (!paneId) return;
  ws.updatePane(paneId, { type: "git", agentId, filePath: worktreePath });
  ws.setFocusedPane(paneId);
  window.dispatchEvent(new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }));
}
