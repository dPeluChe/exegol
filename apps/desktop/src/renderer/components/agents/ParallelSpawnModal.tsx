import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Layers, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { findFirstPaneId, getProjectState, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

interface ParallelSpawnModalProps {
  projectId: string;
  onClose: () => void;
}

export function ParallelSpawnModal({ projectId, onClose }: ParallelSpawnModalProps) {
  const [task, setTask] = useState("");
  const [selectedCliTypes, setSelectedCliTypes] = useState<Set<string>>(new Set());
  const [branchPrefix, setBranchPrefix] = useState("");
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

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const toggleProvider = useCallback((id: string) => {
    setSelectedCliTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const canSpawn = task.trim() && selectedCliTypes.size >= 2 && !spawning;

  const handleSpawn = useCallback(async () => {
    if (!canSpawn) return;
    setSpawning(true);
    try {
      const cliTypes = [...selectedCliTypes];
      // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
      const result = await trpcMutate<any>("agents.spawnParallel", {
        projectId,
        taskDescription: task.trim(),
        cliTypes,
        useWorktree: true,
        branchPrefix: branchPrefix.trim() || undefined,
      });

      const { agentIds } = result as { agentIds: string[] };

      // Open the comparator so the user can watch all variants side-by-side.
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "parallel-runs" } }),
      );

      // Create tabs and terminals for each spawned agent
      const store = useWorkspaceStore.getState();
      for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i];
        if (!agentId) continue;
        const cliType = (cliTypes[i] ?? "custom") as AgentCliType;

        addAgent({
          id: agentId,
          projectId,
          cliType,
          status: "spawning",
          currentStep: null,
          taskDescription: task.trim(),
          branchName: branchPrefix ? `${branchPrefix}-v${i + 1}` : `exegol/parallel-v${i + 1}`,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: Math.floor(Date.now() / 1000),
          accessMode: null,
          claudeSessionId: null,
          activityLevel: "busy",
        });
        createTerminal(agentId);

        // Focus the first agent
        if (i === 0) {
          setFocusedAgent(agentId);
        }

        // Create a new tab for each agent
        const newTabId = store.addTab(cliType);
        const freshPw = getProjectState();
        const newTab = freshPw.tabs.find((t) => t.id === newTabId);
        if (newTab) {
          const paneId = findFirstPaneId(newTab.layout);
          if (paneId) {
            store.updatePane(paneId, { type: "terminal", agentId });
          }
        }
      }

      onClose();
    } catch (err) {
      console.error("[ParallelSpawnModal] Spawn failed:", err);
    } finally {
      setSpawning(false);
    }
  }, [
    canSpawn,
    task,
    selectedCliTypes,
    branchPrefix,
    projectId,
    addAgent,
    createTerminal,
    setFocusedAgent,
    onClose,
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
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Parallel Launch</h2>
          </div>
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
            <label className="text-[11px] font-medium text-text-muted" htmlFor="parallel-task">
              Task
            </label>
            <textarea
              ref={textareaRef}
              id="parallel-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe what the agents should do..."
              rows={3}
              className="resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>

          {/* Multi-select providers */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-muted">
              Agents
              <span className="ml-1 text-text-muted/60">(select 2+)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {enabledProviders.map((p) => {
                const isSelected = selectedCliTypes.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProvider(p.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      isSelected
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                    )}
                  >
                    <AgentIcon
                      provider={p.id}
                      size={16}
                      fallback={p.icon}
                      fallbackColor={p.color}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Branch prefix */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="branch-prefix">
              Branch prefix
              <span className="ml-1 text-text-muted/60">(optional)</span>
            </label>
            <input
              id="branch-prefix"
              type="text"
              value={branchPrefix}
              onChange={(e) => setBranchPrefix(e.target.value)}
              placeholder="exegol/parallel"
              className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-muted">
            {selectedCliTypes.size} agent{selectedCliTypes.size !== 1 ? "s" : ""} selected
            {selectedCliTypes.size < 2 ? " (min 2)" : ""}
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
              disabled={!canSpawn}
              onClick={handleSpawn}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all",
                canSpawn
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed",
              )}
            >
              {spawning
                ? "Launching..."
                : `Launch ${selectedCliTypes.size} Agent${selectedCliTypes.size !== 1 ? "s" : ""}`}
              <span className="ml-1 text-[9px] opacity-60">Cmd+Enter</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
