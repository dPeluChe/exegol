import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, GitBranch, Globe, Plus, Terminal, X } from "lucide-react";
import { type DragEvent, useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { deleteAgentImperative } from "../../hooks/use-delete-agent";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import {
  collectPaneIds,
  findFirstPaneId,
  getProjectState,
  type Pane,
  selectActiveTabId,
  selectPanes,
  selectTabs,
  useWorkspaceStore,
} from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

// ─── Tab auto-naming helpers ────────────────────────────────────────────────

const PANE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  browser: Globe,
  files: FolderTree,
  git: GitBranch,
};

/** Derive display name + icon from the tab's primary pane */
function getTabMeta(
  tabLabel: string,
  tabLayout: import("../../stores/workspace").LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, { cliType: string; taskDescription: string }>,
): { displayName: string; Icon: React.ComponentType<{ className?: string }> | null } {
  // If user explicitly renamed the tab (not a default name), respect it
  const isDefault =
    tabLabel.startsWith("Tab ") || tabLabel === "Workspace" || tabLabel === "Terminal";

  const firstPaneId = findFirstPaneId(tabLayout);
  const firstPane = firstPaneId ? panes[firstPaneId] : null;
  const Icon = firstPane ? (PANE_TYPE_ICONS[firstPane.type] ?? null) : null;

  if (!isDefault) return { displayName: tabLabel, Icon };

  if (firstPane?.type === "terminal" && firstPane.agentId) {
    const agent = agents[firstPane.agentId];
    if (agent) return { displayName: agent.cliType, Icon: Terminal };
  }
  if (firstPane?.type === "browser") return { displayName: "Browser", Icon: Globe };
  if (firstPane?.type === "git") return { displayName: "Git", Icon: GitBranch };
  if (firstPane?.type === "files") return { displayName: "Files", Icon: FolderTree };

  return { displayName: tabLabel, Icon };
}

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
  const { projectId } = useProjectContext();

  /** Close a tab and stop all its terminal agents */
  const handleCloseTab = useCallback(
    (tabId: string) => {
      // Read fresh state to avoid stale closure
      const pw = getProjectState();
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (tab) {
        const paneIds = collectPaneIds(tab.layout);
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
      // Create a new tab first
      const newTabId = addTab("Terminal");
      // Find its empty pane
      const tab = getProjectState().tabs.find((t) => t.id === newTabId);
      const firstPaneId = tab ? findFirstPaneId(tab.layout) : null;

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
      });
      createTerminal(agent.id);

      // Convert the empty pane to terminal
      if (firstPaneId) {
        updatePane(firstPaneId, { type: "terminal", agentId: agent.id });
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
      {/* Tab row */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for pane extraction */}
      <div
        className={cn(
          "flex h-9 items-center gap-0.5 overflow-x-auto px-1 transition-colors",
          paneDragOverBar && "bg-accent/10 ring-1 ring-inset ring-accent/40",
        )}
        onDragOver={handleBarDragOver}
        onDragLeave={handleBarDragLeave}
        onDrop={handleBarDrop}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;
          const { displayName, Icon: TabIcon } = getTabMeta(tab.label, tab.layout, panes, agents);

          return (
            // biome-ignore lint/a11y/useSemanticElements: contains close button — can't nest buttons
            <div
              role="button"
              tabIndex={0}
              key={tab.id}
              draggable={!isEditing}
              onDragStart={(e) => handleTabDragStart(e, tab.id)}
              onDragOver={(e) => handleTabDragOver(e, tab.id)}
              onDragLeave={handleTabDragLeave}
              onDrop={(e) => handleTabDrop(e, tab.id)}
              onDragEnd={handleTabDragEnd}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => startEditing(tab.id, tab.label)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActiveTab(tab.id);
              }}
              className={cn(
                "group relative flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
                "hover:bg-white/5 cursor-pointer",
                isActive ? "bg-white/10 text-text-primary" : "text-text-secondary",
                dragOverTabId === tab.id && "ring-1 ring-accent/50",
              )}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={finishEditing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishEditing();
                    if (e.key === "Escape") setEditingTabId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 bg-transparent text-[11px] text-text-primary outline-none"
                />
              ) : (
                <>
                  {TabIcon && <TabIcon className="h-3 w-3 shrink-0 text-text-muted" />}
                  <span className="max-w-[140px] truncate">{displayName}</span>
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                className={cn(
                  "ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded",
                  "opacity-0 transition-opacity group-hover:opacity-100",
                  "hover:bg-white/10",
                )}
                title="Close tab"
              >
                <X className="h-2.5 w-2.5" />
              </button>
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
              )}
            </div>
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

      {/* Quick-launch bar */}
      <QuickLaunchBar />
    </div>
  );
}

// ─── Quick Launch Bar ───────────────────────────────────────────────────────

function QuickLaunchBar() {
  const { projectId } = useProjectContext();
  const [launching, setLaunching] = useState<string | null>(null);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  const cliAgents = providers ?? [];

  const handleLaunch = useCallback(
    async (cli: AgentProvider) => {
      if (!projectId || launching) return;
      setLaunching(cli.id);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.id as AgentCliType,
          taskDescription: cli.name,
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
        });
        createTerminal(agent.id);

        // Read fresh state to avoid stale closure
        const freshPw = getProjectState();
        const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
        if (activeTab) {
          const firstPaneId = findFirstPaneId(activeTab.layout);
          const firstPane = firstPaneId ? freshPw.panes[firstPaneId] : null;

          // Only replace empty panes or terminals with stopped/no agent
          // NEVER replace a pane with a running agent — that orphans the session
          const agentState = firstPane?.agentId
            ? useAgentStore.getState().agents[firstPane.agentId]
            : null;
          const isRunningAgent =
            agentState &&
            ["running", "spawning", "waiting_input", "paused"].includes(agentState.status);
          const canReplace =
            firstPane?.type === "empty" || (firstPane?.type === "terminal" && !isRunningAgent);

          if (canReplace && firstPaneId) {
            // Replace empty/stopped pane with new agent terminal
            updatePane(firstPaneId, {
              type: "terminal",
              agentId: agent.id,
            });
          } else {
            // Pane has a running agent or is browser/files/git: create a new tab
            const newTabId = addTab(cli.name);
            const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
            if (newTab) {
              const newPaneId = findFirstPaneId(newTab.layout);
              if (newPaneId) {
                useWorkspaceStore.getState().updatePane(newPaneId, {
                  type: "terminal",
                  agentId: agent.id,
                });
              }
            }
          }
        } else {
          // No active tab: create one
          const newTabId = addTab(cli.name);
          const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
          if (newTab) {
            const newPaneId = findFirstPaneId(newTab.layout);
            if (newPaneId) {
              useWorkspaceStore.getState().updatePane(newPaneId, {
                type: "terminal",
                agentId: agent.id,
              });
            }
          }
        }
      } catch (err) {
        console.error("[QuickLaunchBar] Spawn failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, launching, addAgent, createTerminal, updatePane, addTab],
  );

  return (
    <div className="flex h-7 items-center gap-1.5 overflow-x-auto px-2">
      {cliAgents.map((cli) => (
        <button
          type="button"
          key={cli.id}
          disabled={launching === cli.id}
          onClick={() => handleLaunch(cli)}
          className={cn(
            "group/cli relative flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold transition-all",
            "bg-zinc-700 text-zinc-400 hover:text-white",
            launching === cli.id && "opacity-40",
          )}
          style={{ "--cli-color": cli.color } as React.CSSProperties}
          title={cli.name}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = cli.color;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
          }}
        >
          <AgentIcon
            provider={cli.id}
            size={14}
            fallback={cli.icon}
            fallbackColor={cli.color}
            className="rounded-full"
          />
        </button>
      ))}
    </div>
  );
}
