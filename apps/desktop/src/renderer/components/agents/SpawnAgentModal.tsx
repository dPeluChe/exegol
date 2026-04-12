import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Layers, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import {
  findFirstPaneId,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

function slugify(text: string): string {
  return `exegol/${text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "")}`;
}

interface SpawnAgentModalProps {
  projectId: string;
  onClose: () => void;
  initialProvider?: AgentProvider;
}

export function SpawnAgentModal({ projectId, onClose, initialProvider }: SpawnAgentModalProps) {
  const [task, setTask] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState(initialProvider?.id ?? "");
  const [useWorktree, setUseWorktree] = useState(true);
  const [branchName, setBranchName] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  const { data: enabledProviders = [] } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });

  const selectedProvider = enabledProviders.find((p) => p.id === selectedProviderId);

  // Auto-select first provider if none selected
  useEffect(() => {
    if (!selectedProviderId && enabledProviders.length > 0) {
      setSelectedProviderId(enabledProviders[0]?.id ?? "");
    }
  }, [selectedProviderId, enabledProviders]);

  // Auto-derive branch name from task
  useEffect(() => {
    if (!branchEdited && task.trim()) {
      setBranchName(slugify(task.trim()));
    }
  }, [task, branchEdited]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSpawn = useCallback(async () => {
    if (!task.trim() || !selectedProviderId || spawning) return;
    setSpawning(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
      const agent = await trpcMutate<any>("agents.spawn", {
        projectId,
        cliType: selectedProviderId as AgentCliType,
        taskDescription: task.trim(),
        useWorktree,
        branchName: useWorktree && branchName ? branchName : undefined,
      });
      addAgent({
        id: agent.id,
        projectId,
        cliType: agent.cliType,
        status: agent.status,
        currentStep: agent.currentStep,
        taskDescription: agent.taskDescription,
        branchName: agent.branchName ?? (useWorktree ? branchName : null),
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: agent.startedAt,
      });
      createTerminal(agent.id);
      setFocusedAgent(agent.id);
      // Switch to Agents section
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
      );
      // T95: Reuse focused empty pane, otherwise create a new tab
      const store = useWorkspaceStore.getState();
      const freshPw = getProjectState();
      const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
      const focusedId = activeTab ? getFocusedOrFirstPaneId(activeTab) : null;
      const focusedPane = focusedId ? freshPw.panes[focusedId] : null;

      if (focusedPane?.type === "empty" && focusedId) {
        store.updatePane(focusedId, { type: "terminal", agentId: agent.id });
      } else {
        const newTabId = store.addTab(agent.cliType);
        const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
        if (newTab) {
          const paneId = findFirstPaneId(newTab.layout);
          if (paneId) {
            store.updatePane(paneId, { type: "terminal", agentId: agent.id });
          }
        }
      }
      onClose();
    } catch (err) {
      console.error("[SpawnAgentModal] Spawn failed:", err);
    } finally {
      setSpawning(false);
    }
  }, [
    task,
    selectedProviderId,
    useWorktree,
    branchName,
    projectId,
    addAgent,
    createTerminal,
    setFocusedAgent,
    onClose,
    spawning,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSpawn();
    },
    [onClose, handleSpawn],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dialog overlay captures keyboard
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="none" />

      {/* Modal */}
      <div className="relative z-10 w-[480px] rounded-xl border border-border bg-bg-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Launch Agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-4">
          {/* Task prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="task-prompt">
              Task
            </label>
            <textarea
              ref={textareaRef}
              id="task-prompt"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe what the agent should do..."
              rows={3}
              className="resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>

          {/* Agent selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="agent-select">
              Agent
            </label>
            <div className="flex flex-wrap gap-1.5">
              {enabledProviders.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProviderId(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    selectedProviderId === p.id
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                  )}
                >
                  <AgentIcon provider={p.id} size={16} fallback={p.icon} fallbackColor={p.color} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Worktree toggle + branch name */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer" htmlFor="use-worktree">
              <input
                type="checkbox"
                id="use-worktree"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              <GitBranch className="h-3.5 w-3.5 text-text-muted" />
              <span className="text-[11px] font-medium text-text-secondary">
                Work in isolated branch (worktree)
              </span>
            </label>

            {useWorktree && (
              <div className="ml-6 flex items-center gap-2">
                <Layers className="h-3 w-3 shrink-0 text-text-muted" />
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => {
                    setBranchName(e.target.value);
                    setBranchEdited(true);
                  }}
                  placeholder="exegol/branch-name"
                  className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-muted">
            {selectedProvider ? `${selectedProvider.name}` : "Select an agent"}
            {useWorktree ? " · worktree" : " · main repo"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!task.trim() || !selectedProviderId || spawning}
              onClick={handleSpawn}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all",
                task.trim() && selectedProviderId && !spawning
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed",
              )}
            >
              {spawning ? "Launching..." : "Launch"}
              <span className="ml-1 text-[9px] opacity-60">Cmd+Enter</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
