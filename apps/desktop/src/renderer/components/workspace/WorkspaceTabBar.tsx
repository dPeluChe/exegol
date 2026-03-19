import type { AgentCliType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus, Terminal, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { collectPaneIds, findFirstPaneId, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

// ─── CLI Agent definitions ──────────────────────────────────────────────────

interface CliAgent {
  type: AgentCliType;
  short: string;
  color: string;
  name: string;
}

const CLI_AGENTS: CliAgent[] = [
  { type: "claude-code", short: "C", color: "#D97706", name: "Claude" },
  { type: "codex", short: "Co", color: "#10B981", name: "Codex" },
  { type: "gemini", short: "G", color: "#3B82F6", name: "Gemini" },
  { type: "aider", short: "A", color: "#8B5CF6", name: "Aider" },
  { type: "opencode", short: "OC", color: "#EC4899", name: "OpenCode" },
  { type: "goose", short: "Go", color: "#F97316", name: "Goose" },
  { type: "amp", short: "Am", color: "#06B6D4", name: "Amp" },
  { type: "kiro", short: "K", color: "#84CC16", name: "Kiro" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function WorkspaceTabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const { projectId } = useProjectContext();

  /** Close a tab and stop all its terminal agents */
  const handleCloseTab = useCallback(
    (tabId: string) => {
      // Read fresh state to avoid stale closure
      const state = useWorkspaceStore.getState();
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab) {
        const paneIds = collectPaneIds(tab.layout);
        for (const pid of paneIds) {
          const pane = state.panes[pid];
          if (pane?.type === "terminal" && pane.agentId) {
            const agentId = pane.agentId;
            // Stop process then delete from DB — both non-fatal
            trpcMutate("agents.stop", { id: agentId })
              .catch(() => {})
              .then(() => trpcMutate("agents.delete", { id: agentId }).catch(() => {}));
            removeAgent(agentId);
          }
        }
      }
      removeTab(tabId);
    },
    [removeTab, removeAgent],
  );

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleNewTerminal = useCallback(async () => {
    if (!projectId) return;
    try {
      // Create a new tab first
      const newTabId = addTab("Terminal");
      // Find its empty pane
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === newTabId);
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
        branchName: null,
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
      <div className="flex h-9 items-center gap-0.5 overflow-x-auto px-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;

          return (
            // biome-ignore lint/a11y/useSemanticElements: contains close button — can't nest buttons
            <div
              role="button"
              tabIndex={0}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => startEditing(tab.id, tab.label)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActiveTab(tab.id);
              }}
              className={cn(
                "group relative flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
                "hover:bg-white/5 cursor-pointer",
                isActive ? "bg-white/10 text-text-primary" : "text-text-secondary",
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
                <span className="max-w-[140px] truncate">{tab.label}</span>
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
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const panes = useWorkspaceStore((s) => s.panes);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);

  const handleLaunch = useCallback(
    async (cli: CliAgent) => {
      if (!projectId) return;
      setLaunching(cli.type);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.type,
          taskDescription: cli.name,
        });

        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: null,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: agent.startedAt,
        });
        createTerminal(agent.id);

        // Find active tab and check if current pane is empty
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab) {
          const firstPaneId = findFirstPaneId(activeTab.layout);
          const firstPane = firstPaneId ? panes[firstPaneId] : null;

          if (firstPane?.type === "empty") {
            // Convert empty pane to terminal
            updatePane(firstPane.id, {
              type: "terminal",
              agentId: agent.id,
            });
          } else {
            // Active pane is occupied: create a new tab
            const newTabId = addTab(cli.name);
            const newTab = useWorkspaceStore.getState().tabs.find((t) => t.id === newTabId);
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
          const newTab = useWorkspaceStore.getState().tabs.find((t) => t.id === newTabId);
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
    [projectId, activeTabId, tabs, panes, addAgent, createTerminal, updatePane, addTab],
  );

  return (
    <div className="flex h-7 items-center gap-1.5 overflow-x-auto px-2">
      {CLI_AGENTS.map((cli) => (
        <button
          type="button"
          key={cli.type}
          disabled={launching === cli.type}
          onClick={() => handleLaunch(cli)}
          className={cn(
            "group/cli relative flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold transition-all",
            "bg-zinc-700 text-zinc-400 hover:text-white",
            launching === cli.type && "opacity-40",
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
            provider={cli.type}
            size={14}
            fallback={cli.short}
            fallbackColor={cli.color}
            className="rounded-full"
          />
        </button>
      ))}
    </div>
  );
}

export type { CliAgent };
export { CLI_AGENTS };
