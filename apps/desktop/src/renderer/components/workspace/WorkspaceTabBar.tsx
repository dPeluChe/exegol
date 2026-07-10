import { cn } from "@exegol/ui";
import { Plus, Terminal } from "lucide-react";
import { type DragEvent, useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { deleteAgentImperative } from "../../hooks/use-delete-agent";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import {
  collectPaneIds,
  findFirstPaneId,
  getFocusedOrFirstPaneId,
  getProjectState,
  selectActiveTabId,
  selectPanes,
  selectTabs,
  useWorkspaceStore,
} from "../../stores/workspace";
import { LayoutPresets } from "./LayoutPresets";
import { QuickLaunchBar } from "./QuickLaunchBar";
import { getTabMeta } from "./tab-bar-helpers";
import { WorkspaceTabItem } from "./WorkspaceTabItem";

// ─── Component ──────────────────────────────────────────────────────────────

export function WorkspaceTabBar() {
  const tabs = useWorkspaceStore(selectTabs);
  const activeTabId = useWorkspaceStore(selectActiveTabId);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const reorderTab = useWorkspaceStore((s) => s.reorderTab);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const panes = useWorkspaceStore(selectPanes);
  const agents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const { projectId } = useProjectContext();

  /** Close a tab — confirm first if it has running agents */
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const pw = getProjectState();
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (tab) {
        const paneIds = collectPaneIds(tab.layout);
        const runningAgentIds: string[] = [];
        for (const pid of paneIds) {
          const pane = pw.panes[pid];
          if (pane?.type === "terminal" && pane.agentId) {
            const agent = useAgentStore.getState().agents[pane.agentId];
            if (agent && ["running", "spawning", "waiting_input"].includes(agent.status)) {
              runningAgentIds.push(pane.agentId);
            }
          }
        }
        // Confirm before killing running agents
        if (runningAgentIds.length > 0) {
          const count = runningAgentIds.length;
          const ok = window.confirm(
            `This tab has ${count} running agent${count > 1 ? "s" : ""}. Close and stop ${count > 1 ? "them" : "it"}?`,
          );
          if (!ok) return;
        }
        // Stop + cleanup all terminal agents in the tab
        for (const pid of paneIds) {
          const pane = pw.panes[pid];
          if (pane?.type === "terminal" && pane.agentId) {
            deleteAgentImperative(pane.agentId);
          }
        }
      }
      removeTab(tabId);
    },
    [removeTab],
  );

  const extractPaneToNewTab = useWorkspaceStore((s) => s.extractPaneToNewTab);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [paneDragOverBar, setPaneDragOverBar] = useState(false);
  const draggedTabIdRef = useRef<string | null>(null);

  const handleTabDragStart = useCallback((e: DragEvent, tabId: string) => {
    draggedTabIdRef.current = tabId;
    e.dataTransfer.setData("application/exegol-tab", tabId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleTabDragOver = useCallback((e: DragEvent, tabId: string) => {
    if (!e.dataTransfer.types.includes("application/exegol-tab")) return;
    e.preventDefault();
    e.stopPropagation(); // Keep drag inside tab bar — don't trigger pane merge indicators
    e.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
  }, []);

  const handleTabDragLeave = useCallback(() => {
    setDragOverTabId(null);
  }, []);

  const handleTabDrop = useCallback(
    (e: DragEvent, targetTabId: string) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent bubbling to WorkspacePane merge handler
      setDragOverTabId(null);
      const sourceTabId = e.dataTransfer.getData("application/exegol-tab");
      if (!sourceTabId || sourceTabId === targetTabId) return;
      const fromIndex = tabs.findIndex((t) => t.id === sourceTabId);
      const toIndex = tabs.findIndex((t) => t.id === targetTabId);
      if (fromIndex !== -1 && toIndex !== -1) {
        reorderTab(fromIndex, toIndex);
      }
    },
    [tabs, reorderTab],
  );

  const handleTabDragEnd = useCallback(() => {
    draggedTabIdRef.current = null;
    setDragOverTabId(null);
  }, []);

  // Pane drag → tab bar: extract pane to new tab
  const handleBarDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("application/exegol-pane")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setPaneDragOverBar(true);
  }, []);

  const handleBarDragLeave = useCallback((e: DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setPaneDragOverBar(false);
  }, []);

  const handleBarDrop = useCallback(
    (e: DragEvent) => {
      setPaneDragOverBar(false);
      const raw = e.dataTransfer.getData("application/exegol-pane");
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const { paneId, tabId: sourceTabId } = JSON.parse(raw);
        extractPaneToNewTab(sourceTabId, paneId);
        dispatchRefitTerminals();
      } catch {
        // Malformed data — ignore
      }
    },
    [extractPaneToNewTab],
  );

  const handleNewTerminal = useCallback(async () => {
    if (!projectId) return;
    try {
      // T95: Reuse focused empty pane, otherwise create a new tab
      const freshPw = getProjectState();
      const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
      const focusedId = activeTab ? getFocusedOrFirstPaneId(activeTab) : null;
      const focusedPane = focusedId ? freshPw.panes[focusedId] : null;

      let targetPaneId: string | null = null;

      if (focusedPane?.type === "empty" && focusedId) {
        targetPaneId = focusedId;
      } else {
        const newTabId = addTab("Terminal");
        const tab = getProjectState().tabs.find((t) => t.id === newTabId);
        targetPaneId = tab ? findFirstPaneId(tab.layout) : null;
      }

      // Spawn a shell agent
      // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
      const agent = await trpcMutate<any>("agents.spawn", {
        projectId,
        cliType: "shell",
        taskDescription: "Terminal",
      });
      addAgent({
        id: agent.id,
        projectId,
        cliType: agent.cliType,
        status: agent.status,
        currentStep: agent.currentStep,
        taskDescription: agent.taskDescription,
        branchName: agent.branchName ?? null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: agent.startedAt,
        accessMode: agent.accessMode ?? null,
        claudeSessionId: null,
        activityLevel: "busy",
      });
      createTerminal(agent.id);

      // Convert the target pane to terminal
      if (targetPaneId) {
        updatePane(targetPaneId, { type: "terminal", agentId: agent.id });
      }
    } catch {
      // Spawn failed — tab stays with empty pane
    }
  }, [projectId, addTab, addAgent, createTerminal, updatePane]);

  const startEditing = useCallback((tabId: string, currentLabel: string) => {
    setEditingTabId(tabId);
    setEditValue(currentLabel);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const finishEditing = useCallback(() => {
    if (editingTabId && editValue.trim()) {
      renameTab(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  }, [editingTabId, editValue, renameTab]);

  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary">
      {/* Tab row: scrollable tabs + trailing action bar (outside overflow) */}
      <div className="flex h-9 items-center">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for pane extraction */}
        <div
          className={cn(
            "flex h-9 flex-1 items-center gap-0.5 overflow-x-auto px-1 transition-colors",
            paneDragOverBar && "bg-accent/10 ring-1 ring-inset ring-accent/40",
          )}
          onDragOver={handleBarDragOver}
          onDragLeave={handleBarDragLeave}
          onDrop={handleBarDrop}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isEditing = editingTabId === tab.id;
            const {
              displayName,
              Icon: TabIcon,
              primaryAgentId,
            } = getTabMeta(tab.label, tab.layout, panes, agents);
            const tabActivity = primaryAgentId ? agents[primaryAgentId]?.activityLevel : undefined;
            // T155.3: unread attention beats activity in the tab dot
            const attentionItem = primaryAgentId ? attentionItems[primaryAgentId] : undefined;
            const tabAttention = !!attentionItem && !attentionItem.read;

            return (
              <WorkspaceTabItem
                key={tab.id}
                tab={tab}
                isActive={isActive}
                isEditing={isEditing}
                displayName={displayName}
                TabIcon={TabIcon}
                tabActivity={tabActivity}
                tabAttention={tabAttention}
                dragOverTabId={dragOverTabId}
                editValue={editValue}
                setEditValue={setEditValue}
                setEditingTabId={setEditingTabId}
                inputRef={inputRef}
                finishEditing={finishEditing}
                startEditing={startEditing}
                setActiveTab={setActiveTab}
                handleCloseTab={handleCloseTab}
                handleTabDragStart={handleTabDragStart}
                handleTabDragOver={handleTabDragOver}
                handleTabDragLeave={handleTabDragLeave}
                handleTabDrop={handleTabDrop}
                handleTabDragEnd={handleTabDragEnd}
              />
            );
          })}

          {/* Add tab button */}
          <button
            type="button"
            onClick={() => addTab()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/5"
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {/* Quick terminal button */}
          <button
            type="button"
            onClick={handleNewTerminal}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/5 hover:text-accent"
            title="New terminal"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Trailing actions — outside the overflow container so dropdowns escape clipping */}
        <div className="flex h-9 shrink-0 items-center border-l border-border/40 px-1">
          <LayoutPresets tabId={activeTabId} />
        </div>
      </div>

      {/* Quick-launch bar */}
      <QuickLaunchBar />
    </div>
  );
}
