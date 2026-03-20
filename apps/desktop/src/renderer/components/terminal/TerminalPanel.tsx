import type { HandoffSummary } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent, useScrollback, useSpawnAgent } from "../../hooks/use-trpc";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import { EmptyState, LoadingSpinner } from "../common";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";

interface TerminalPanelProps {
  agentId: string;
  paneId?: string;
  onReady?: () => void;
}

const STOPPED_STATUSES = new Set(["completed", "failed", "stopped", "crashed"]);

function useHandoff(agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["handoff", agentId],
    queryFn: () => trpcInvoke<HandoffSummary | null>("agents.getHandoff", { agentId }),
    enabled,
    staleTime: 30_000,
  });
}

export function TerminalPanel({ agentId, paneId, onReady }: TerminalPanelProps) {
  const { data: agent } = useAgent(agentId);
  const isStopped = agent ? STOPPED_STATUSES.has(agent.status) : false;
  const { data: scrollbackContent, isLoading: scrollbackLoading } = useScrollback(
    isStopped ? agentId : null,
  );
  const spawnAgent = useSpawnAgent();
  const { data: handoff } = useHandoff(agentId, isStopped);
  const [liveHandoff, setLiveHandoff] = useState<HandoffSummary | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const terminalRef = useRef<TerminalInstanceHandle>(null);
  const didSerializeRef = useRef(false);

  // Resolved handoff: from query (stopped agents) or live IPC (running agents)
  const resolvedHandoff = isStopped ? (handoff ?? null) : liveHandoff;

  // Listen for real-time handoff notifications on live agents (external system sync — rule #4)
  useEffect(() => {
    if (isStopped) return;
    const handler = (_agentId: string, _handoffId: string) => {
      if (_agentId === agentId) {
        trpcInvoke<HandoffSummary | null>("agents.getHandoff", { agentId })
          .then(setLiveHandoff)
          .catch(() => {});
      }
    };
    const cleanup = window.api?.onAgentHandoff?.(handler);
    return () => {
      cleanup?.();
    };
  }, [agentId, isStopped]);

  // When agent transitions to stopped, serialize terminal state and persist it
  const persistSerializedState = useCallback(() => {
    if (didSerializeRef.current) return;
    const serialized = terminalRef.current?.serialize();
    if (!serialized) return;
    didSerializeRef.current = true;
    trpcMutate("scrollback.saveSerialized", { agentId, content: serialized }).catch(() => {
      // Non-fatal: raw scrollback still available as fallback
    });
  }, [agentId]);

  useEffect(() => {
    if (isStopped) {
      persistSerializedState();
    }
  }, [isStopped, persistSerializedState]);

  const handleContinueWithHandoff = useCallback(async () => {
    if (!agent || handoffLoading) return;
    setHandoffLoading(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
      const successor = await trpcMutate<any>("agents.continueWithHandoff", {
        agentId: agent.id,
      });
      addAgent({
        id: successor.id,
        projectId: successor.projectId,
        cliType: successor.cliType,
        status: successor.status,
        currentStep: successor.currentStep,
        taskDescription: successor.taskDescription,
        branchName: null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: successor.startedAt,
      });
      createTerminal(successor.id);
      setFocusedAgent(successor.id);
    } catch (err) {
      console.error("[TerminalPanel] Handoff continuation failed:", err);
    } finally {
      setHandoffLoading(false);
    }
  }, [agent, handoffLoading, addAgent, createTerminal, setFocusedAgent]);

  // If agent is stopped and has scrollback, show read-only terminal
  if (isStopped && scrollbackContent) {
    return (
      <div className="relative flex h-full flex-col">
        {/* Read-only banner — text left, buttons center */}
        <div
          className={`relative flex shrink-0 items-center px-3 py-1.5 text-[11px] ${agent?.status === "crashed" ? "bg-red-500/10" : "bg-yellow-500/10"}`}
        >
          {/* Left: status text */}
          <div className="flex items-center gap-1.5">
            <AlertCircle
              className={`h-3.5 w-3.5 shrink-0 ${agent?.status === "crashed" ? "text-red-400" : "text-yellow-400"}`}
            />
            <span
              className={agent?.status === "crashed" ? "text-red-200/80" : "text-yellow-200/80"}
            >
              {agent?.status === "crashed" ? "Crashed" : "Ended"}
            </span>
          </div>
          {/* Center: action buttons (absolute to truly center regardless of left text width) */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none">
            {agent && (
              <Button
                variant="ghost"
                size="sm"
                className="pointer-events-auto h-6 gap-1 rounded-md border border-accent/30 px-2 text-[10px] text-accent hover:bg-accent/10"
                onClick={async () => {
                  // Re-launch with original task description only
                  // (no scrollback injection — use CLI native resume when available)
                  const newAgent = await spawnAgent.mutateAsync({
                    projectId: agent.projectId,
                    cliType: agent.cliType,
                    taskDescription: agent.taskDescription,
                  });

                  if (paneId && newAgent?.id) {
                    // Clean up old crashed agent from store + DB
                    removeAgent(agent.id);
                    trpcMutate("agents.delete", { id: agent.id }).catch(() => {});

                    // Show new agent in same pane
                    addAgent({
                      id: newAgent.id,
                      projectId: newAgent.projectId,
                      cliType: newAgent.cliType,
                      status: newAgent.status,
                      currentStep: newAgent.currentStep,
                      taskDescription: newAgent.taskDescription,
                      branchName: null,
                      tokenUsage: { input: 0, output: 0, cost: 0 },
                      startedAt: newAgent.startedAt,
                    });
                    createTerminal(newAgent.id);
                    useWorkspaceStore.getState().updatePane(paneId, {
                      type: "terminal",
                      agentId: newAgent.id,
                    });
                  }
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Re-launch
              </Button>
            )}
            {resolvedHandoff && (
              <Button
                variant="ghost"
                size="sm"
                className="pointer-events-auto h-6 gap-1 rounded-md border border-border px-2 text-[10px] text-text-secondary hover:bg-white/5"
                onClick={handleContinueWithHandoff}
                disabled={handoffLoading}
              >
                <ArrowRight className="h-3 w-3" />
                {handoffLoading ? "..." : "Continue"}
              </Button>
            )}
          </div>
        </div>
        {/* Handoff summary banner */}
        {resolvedHandoff && (
          <div className="shrink-0 border-b border-border bg-blue-500/5 px-3 py-2">
            <p className="text-[10px] font-medium text-blue-300">Handoff available</p>
            <p className="mt-0.5 text-[10px] text-text-muted">
              Goal: {resolvedHandoff.goal.slice(0, 100)}
              {resolvedHandoff.goal.length > 100 ? "..." : ""}
            </p>
          </div>
        )}
        <div className="flex-1">
          <TerminalInstance
            key={`scrollback-${agentId}`}
            agentId={agentId}
            readOnly
            initialContent={scrollbackContent}
          />
        </div>
      </div>
    );
  }

  // If stopped with no scrollback yet (loading or no data)
  if (isStopped && !scrollbackContent) {
    if (scrollbackLoading) {
      return <LoadingSpinner label="Loading session history..." className="h-full" />;
    }
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-text-muted" />}
        title="Session ended"
        description="No history available"
        className="h-full"
      />
    );
  }

  // Live terminal — show handoff banner if token limit detected
  return (
    <div className="flex h-full flex-col">
      {resolvedHandoff && (
        <div className="flex shrink-0 items-center gap-2 bg-orange-500/10 px-3 py-1.5 text-[11px]">
          <AlertCircle className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-orange-200/80">Token limit approaching — handoff ready</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-[11px] text-accent"
            onClick={handleContinueWithHandoff}
            disabled={handoffLoading}
          >
            <ArrowRight className="h-3 w-3" />
            {handoffLoading ? "Spawning..." : "Continue with new agent"}
          </Button>
        </div>
      )}
      <div className="flex-1">
        <TerminalInstance ref={terminalRef} key={agentId} agentId={agentId} onReady={onReady} />
      </div>
    </div>
  );
}
