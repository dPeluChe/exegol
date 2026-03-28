import type { AgentCliType, AgentProvider, QueueTask } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, ListOrdered, Plus, Zap } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useTerminalStore } from "../../stores/terminals";
import { AgentIcon } from "../common/AgentIcon";
import { SpawnAgentModal } from "./SpawnAgentModal";

// ─── Provider hook ───────────────────────────────────────────────────────────

function useEnabledProviders() {
  return useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
}

// ─── Agent Launcher ─────────────────────────────────────────────────────────

interface AgentLauncherProps {
  projectId: string;
}

function useAddToQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId: string; prompt: string; cliType: string }) =>
      trpcMutate<QueueTask>("queue.add", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

export function AgentLauncher({ projectId }: AgentLauncherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [mode, setMode] = useState<"spawn" | "queue">("spawn");
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [modalProvider, setModalProvider] = useState<AgentProvider | undefined>(undefined);
  const btnRef = useRef<HTMLButtonElement>(null);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const { data: providers } = useEnabledProviders();
  const addToQueue = useAddToQueue();

  const handleLaunch = useCallback(
    async (provider: AgentProvider) => {
      setLaunching(provider.id);
      try {
        if (mode === "queue") {
          // Add to queue instead of spawning
          await addToQueue.mutateAsync({
            projectId,
            prompt: provider.name,
            cliType: provider.id,
          });
          setMenuOpen(false);
          return;
        }

        // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: provider.id as AgentCliType,
          taskDescription: provider.name,
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
        setFocusedAgent(agent.id);
        if (useAppStore.getState().activeView !== "workspace") {
          useAppStore.getState().setActiveView("workspace");
        }
      } catch (err) {
        console.error("[AgentLauncher] Spawn failed:", err);
      } finally {
        setLaunching(null);
        setMenuOpen(false);
      }
    },
    [projectId, addAgent, createTerminal, setFocusedAgent, mode, addToQueue],
  );

  // Calculate menu position from button ref
  const rect = btnRef.current?.getBoundingClientRect();
  const menuStyle = rect
    ? { top: rect.bottom + 4, left: rect.left, position: "fixed" as const }
    : { top: 0, left: 0, position: "fixed" as const, display: "none" as const };

  const displayProviders = providers ?? [];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-accent/20 hover:text-accent"
        title="Launch agent"
      >
        <Plus className="h-3 w-3" />
      </button>

      {/* Portal menu — renders at document root to avoid overflow clipping */}
      {menuOpen &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setMenuOpen(false)}
              onKeyDown={() => {}}
              role="none"
            />
            {/* Menu */}
            <div
              className="z-[101] w-44 rounded-lg border border-border bg-bg-secondary p-1 shadow-2xl"
              style={menuStyle}
            >
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                  {mode === "spawn" ? "Launch Agent" : "Add to Queue"}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMode(mode === "spawn" ? "queue" : "spawn");
                  }}
                  className="rounded p-0.5 text-text-muted hover:text-accent"
                  title={mode === "spawn" ? "Switch to queue mode" : "Switch to launch mode"}
                >
                  {mode === "spawn" ? (
                    <ListOrdered className="h-3 w-3" />
                  ) : (
                    <Zap className="h-3 w-3" />
                  )}
                </button>
              </div>
              {/* New Task — opens modal with full options */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setModalProvider(undefined);
                  setShowSpawnModal(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/10 text-accent"
              >
                <FileCode className="h-4 w-4" />
                <span className="font-semibold">New Task...</span>
              </button>
              <div className="my-1 h-px bg-border" />
              {displayProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  disabled={launching === provider.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) {
                      // Alt+click → open modal with this provider pre-selected
                      setMenuOpen(false);
                      setModalProvider(provider);
                      setShowSpawnModal(true);
                      return;
                    }
                    handleLaunch(provider);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
                    launching === provider.id && "opacity-50",
                  )}
                >
                  <AgentIcon
                    provider={provider.id}
                    size={20}
                    fallback={provider.icon}
                    fallbackColor={provider.color}
                  />
                  <span className="font-medium text-text-primary">{provider.name}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}

      {/* Spawn Agent Modal — full task form with worktree options */}
      {showSpawnModal && (
        <SpawnAgentModal
          projectId={projectId}
          onClose={() => setShowSpawnModal(false)}
          initialProvider={modalProvider}
        />
      )}
    </>
  );
}
