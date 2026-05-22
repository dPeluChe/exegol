import type { AgentProvider, HandoffSummary } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent, useScrollback, useStopAgent } from "../../hooks/use-trpc";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { EmptyState, LoadingSpinner } from "../common";
import { ChatView } from "./ChatView";
import { TerminalFloatingButtons } from "./TerminalFloatingButtons";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";
import { TerminalScrollback } from "./TerminalScrollback";
import { LiveHandoffBanner, LiveStartOverlay, TerminalToolbar } from "./TerminalToolbar";
import { useTerminalLifecycle } from "./use-terminal-lifecycle";

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
  const { data: handoff } = useHandoff(agentId, rawIsStopped);
  const [liveHandoff, setLiveHandoff] = useState<HandoffSummary | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [scrollAtTop, setScrollAtTop] = useState(true);
  const [scrollAtBottom, setScrollAtBottom] = useState(true);
  const [showSendTo, setShowSendTo] = useState(false);
  const [viewMode, setViewMode] = useState<"terminal" | "chat">("terminal");
  const [liveSnapshot, setLiveSnapshot] = useState("");
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const terminalRef = useRef<TerminalInstanceHandle>(null);
  const didSerializeRef = useRef(false);
  const stopAgent = useStopAgent();
  const { hasData, hasEverHadData, startTimedOut } = useTerminalLifecycle({
    agentId,
    isStopped: rawIsStopped,
  });

  // Don't show "Ended" UI until we've received at least one data chunk,
  // OR until scrollback is available in DB (reattach/reload scenario)
  const isStopped = rawIsStopped && (hasEverHadData || !!scrollbackContent);

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
        activityLevel: "busy",
      });
      createTerminal(successor.id);
      setFocusedAgent(successor.id);
    } catch (err) {
      console.error("[TerminalPanel] Handoff continuation failed:", err);
    } finally {
      setHandoffLoading(false);
    }
  }, [agent, handoffLoading, addAgent, createTerminal, setFocusedAgent]);

  const handleToggleLiveView = useCallback(() => {
    if (viewMode === "terminal") {
      setLiveSnapshot(terminalRef.current?.serialize() ?? "");
      setViewMode("chat");
    } else {
      setViewMode("terminal");
    }
  }, [viewMode]);

  const floatingButtons = (
    <TerminalFloatingButtons
      terminalRef={terminalRef}
      scrollAtTop={scrollAtTop}
      scrollAtBottom={scrollAtBottom}
      sendTargets={sendTargets}
      showSendTo={showSendTo}
      setShowSendTo={setShowSendTo}
      onSendTo={handleSendTo}
    />
  );

  // If agent is stopped and has scrollback, show read-only terminal
  if (isStopped && scrollbackContent) {
    return (
      <TerminalScrollback
        agent={agent}
        agentId={agentId}
        scrollbackContent={scrollbackContent}
        resolvedHandoff={resolvedHandoff}
        resumableCliTypes={resumableCliTypes}
        paneId={paneId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        handoffLoading={handoffLoading}
        onContinueWithHandoff={handleContinueWithHandoff}
        terminalRef={terminalRef}
        onScrollPosition={handleScrollPosition}
        floatingButtons={floatingButtons}
      />
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
        <LiveStartOverlay
          cliType={agent?.cliType}
          timedOut={startTimedOut}
          onDismiss={() => stopAgent.mutate(agentId)}
        />
      )}
      {resolvedHandoff && (
        <LiveHandoffBanner onContinue={handleContinueWithHandoff} loading={handoffLoading} />
      )}
      {hasData && (
        <TerminalToolbar
          accessMode={agent?.accessMode}
          viewMode={viewMode}
          onToggleView={handleToggleLiveView}
        />
      )}
      <div className="relative flex-1">
        {viewMode === "chat" ? (
          <ChatView scrollback={liveSnapshot} cliType={agent?.cliType} />
        ) : (
          <>
            <TerminalInstance
              ref={terminalRef}
              key={agentId}
              agentId={agentId}
              cliType={agent?.cliType}
              onReady={onReady}
              onScrollPosition={handleScrollPosition}
            />
            {floatingButtons}
          </>
        )}
      </div>
    </div>
  );
}
