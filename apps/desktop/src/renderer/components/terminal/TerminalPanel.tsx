import type { AgentProvider, HandoffSummary } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  Loader2,
  Play,
  RotateCcw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent, useScrollback, useSpawnAgent } from "../../hooks/use-trpc";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import { EmptyState, LoadingSpinner } from "../common";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";

/** Hook: set of CLI types that support session resume (from provider registry) */
function useResumableCliTypes(): Set<string> {
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 60_000,
  });
  return useMemo(
    () => new Set((providers ?? []).filter((p) => p.capabilities?.supportsResume).map((p) => p.id)),
    [providers],
  );
}

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
  // Use push-driven store for instant status updates (not 30s polling)
  const resumableCliTypes = useResumableCliTypes();
  const storeAgent = useAgentStore((s) => s.agents[agentId]);
  const { data: dbAgent } = useAgent(agentId);
  // Prefer store (push events) over DB query (polling fallback)
  const agent = storeAgent ?? dbAgent ?? null;
  const rawIsStopped = agent ? STOPPED_STATUSES.has(agent.status) : false;
  const { data: scrollbackContent, isLoading: scrollbackLoading } = useScrollback(
    rawIsStopped ? agentId : null,
  );
  const spawnAgent = useSpawnAgent();
  const { data: handoff } = useHandoff(agentId, rawIsStopped);
  const [liveHandoff, setLiveHandoff] = useState<HandoffSummary | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [scrollAtTop, setScrollAtTop] = useState(true);
  const [scrollAtBottom, setScrollAtBottom] = useState(true);
  const [showSendTo, setShowSendTo] = useState(false);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const terminalRef = useRef<TerminalInstanceHandle>(null);
  const didSerializeRef = useRef(false);
  const [hasData, setHasData] = useState(false);
  const hasEverHadDataRef = useRef(false);
  if (hasData) hasEverHadDataRef.current = true;

  // Don't show "Ended" UI until we've received at least one data chunk,
  // OR until scrollback is available in DB (reattach/reload scenario)
  const isStopped = rawIsStopped && (hasEverHadDataRef.current || !!scrollbackContent);

  const allAgents = useAgentStore((s) => s.agents);

  const handleScrollPosition = useCallback((atTop: boolean, atBottom: boolean) => {
    setScrollAtTop(atTop);
    setScrollAtBottom(atBottom);
  }, []);

  /** Running agents in other panes (targets for "Send to") */
  const sendTargets = Object.values(allAgents).filter(
    (a) => a.id !== agentId && ["running", "waiting_input"].includes(a.status),
  );

  const handleSendTo = useCallback((targetId: string) => {
    const text = terminalRef.current?.getSelection();
    if (!text) return;
    window.api.terminal.write(targetId, text);
    setShowSendTo(false);
  }, []);

  // Resolved handoff: from query (stopped agents) or live IPC (running agents)
  const resolvedHandoff = isStopped ? (handoff ?? null) : liveHandoff;

  // T39b: Detect first terminal data to dismiss loading overlay.
  // On a cold mount (reattach after app restart), the PTY may be silent
  // (e.g., an interactive CLI waiting for input) but the ring buffer
  // already contains output from before the restart — so we ALSO probe
  // the snapshot on mount and treat non-empty snapshots as "has data".
  // Without this, reattached terminals stay stuck on "Starting crush..."
  // forever because no new data event ever fires.
  useEffect(() => {
    if (isStopped || hasData) return;
    const unsub = window.api.terminal.onData(agentId, () => {
      setHasData(true);
      unsub();
    });
    window.api.terminal.getSnapshot(agentId).then((snapshot) => {
      if (snapshot && snapshot.length > 0) setHasData(true);
    });
    return unsub;
  }, [agentId, isStopped, hasData]);

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
        branchName: successor.branchName ?? null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: successor.startedAt,
        accessMode: successor.accessMode ?? null,
        claudeSessionId: null,
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
            {agent &&
              (() => {
                const canResume = resumableCliTypes.has(agent.cliType);
                const ResumeIcon = canResume ? Play : RotateCcw;
                const label = canResume ? "Resume" : "Re-launch";

                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="pointer-events-auto h-6 gap-1 rounded-md border border-accent/30 px-2 text-[10px] text-accent hover:bg-accent/10"
                    onClick={async () => {
                      const newAgent = await spawnAgent.mutateAsync({
                        projectId: agent.projectId,
                        cliType: agent.cliType,
                        taskDescription: agent.taskDescription,
                        useWorktree: !!agent.branchName,
                        branchName: agent.branchName ?? undefined,
                        resumeSession: canResume,
                        // T101: pass crashed agent's ID so main process can look up claude_session_id
                        resumeFromAgentId: canResume ? agent.id : undefined,
                      });

                      if (paneId && newAgent?.id) {
                        removeAgent(agent.id);
                        trpcMutate("agents.delete", { id: agent.id }).catch(() => {});

                        addAgent({
                          id: newAgent.id,
                          projectId: newAgent.projectId,
                          cliType: newAgent.cliType,
                          status: newAgent.status,
                          currentStep: newAgent.currentStep,
                          taskDescription: newAgent.taskDescription,
                          branchName: newAgent.branchName ?? null,
                          tokenUsage: { input: 0, output: 0, cost: 0 },
                          startedAt: newAgent.startedAt,
                          accessMode: newAgent.accessMode ?? null,
                          claudeSessionId: null,
                        });
                        createTerminal(newAgent.id);
                        useWorkspaceStore.getState().updatePane(paneId, {
                          type: "terminal",
                          agentId: newAgent.id,
                        });
                      }
                    }}
                  >
                    <ResumeIcon className="h-3 w-3" />
                    {label}
                  </Button>
                );
              })()}
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
        <div className="relative flex-1">
          <TerminalInstance
            ref={terminalRef}
            key={`scrollback-${agentId}`}
            agentId={agentId}
            cliType={agent?.cliType}
            readOnly
            initialContent={scrollbackContent}
            onScrollPosition={handleScrollPosition}
          />
          <TerminalFloatingButtons
            terminalRef={terminalRef}
            scrollAtTop={scrollAtTop}
            scrollAtBottom={scrollAtBottom}
            sendTargets={sendTargets}
            showSendTo={showSendTo}
            setShowSendTo={setShowSendTo}
            onSendTo={handleSendTo}
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

  // Live terminal — show loading overlay until first data arrives
  return (
    <div className="relative flex h-full flex-col">
      {!hasData && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg-primary transition-opacity">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span className="text-[11px] text-text-muted">
            Starting {agent?.cliType ?? "agent"}...
          </span>
        </div>
      )}
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
      <div className="relative flex-1">
        <TerminalInstance
          ref={terminalRef}
          key={agentId}
          agentId={agentId}
          cliType={agent?.cliType}
          onReady={onReady}
          onScrollPosition={handleScrollPosition}
        />
        <TerminalFloatingButtons
          terminalRef={terminalRef}
          scrollAtTop={scrollAtTop}
          scrollAtBottom={scrollAtBottom}
          sendTargets={sendTargets}
          showSendTo={showSendTo}
          setShowSendTo={setShowSendTo}
          onSendTo={handleSendTo}
        />
      </div>
    </div>
  );
}

// ─── Floating scroll + send-to buttons ──────────────────────────────────────

function TerminalFloatingButtons({
  terminalRef,
  scrollAtTop,
  scrollAtBottom,
  sendTargets,
  showSendTo,
  setShowSendTo,
  onSendTo,
}: {
  terminalRef: React.RefObject<TerminalInstanceHandle | null>;
  scrollAtTop: boolean;
  scrollAtBottom: boolean;
  sendTargets: Array<{ id: string; cliType: string; taskDescription: string }>;
  showSendTo: boolean;
  setShowSendTo: (v: boolean) => void;
  onSendTo: (targetId: string) => void;
}) {
  return (
    <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-1.5">
      {/* Send to picker */}
      {showSendTo && sendTargets.length > 0 && (
        <div
          className="mb-1 rounded-lg border p-1 shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <p className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Send selection to
          </p>
          {sendTargets.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSendTo(a.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-white/10"
            >
              <span className="font-medium text-accent">{a.cliType}</span>
              <span className="truncate text-text-muted">
                {a.taskDescription?.slice(0, 40) || a.id}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        {/* Send to button (visible when there are other running agents) */}
        {sendTargets.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSendTo(!showSendTo)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] shadow-lg transition-all",
              showSendTo
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-bg-secondary/90 text-text-muted hover:text-text-primary",
            )}
            title="Send selected text to another agent"
          >
            <Send className="h-3 w-3" />
            <span>Send to</span>
          </button>
        )}

        {/* Scroll navigation */}
        {!scrollAtTop && (
          <button
            type="button"
            onClick={() => terminalRef.current?.scrollToTop()}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-secondary/90 text-text-muted shadow-lg transition-colors hover:text-text-primary"
            title="Scroll to top"
          >
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </button>
        )}
        {!scrollAtBottom && (
          <button
            type="button"
            onClick={() => terminalRef.current?.scrollToBottom()}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-secondary/90 text-text-muted shadow-lg transition-colors hover:text-text-primary"
            title="Scroll to bottom"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
