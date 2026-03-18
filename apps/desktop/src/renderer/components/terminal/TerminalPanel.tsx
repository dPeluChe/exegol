import { Button } from "@exegol/ui";
import { AlertCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useAgent, useScrollback, useSpawnAgent } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";

interface TerminalPanelProps {
  agentId: string;
  onReady?: () => void;
}

const STOPPED_STATUSES = new Set(["completed", "failed", "stopped"]);

export function TerminalPanel({ agentId, onReady }: TerminalPanelProps) {
  const { data: agent } = useAgent(agentId);
  const isStopped = agent ? STOPPED_STATUSES.has(agent.status) : false;
  const { data: scrollbackContent, isLoading: scrollbackLoading } = useScrollback(
    isStopped ? agentId : null,
  );
  const spawnAgent = useSpawnAgent();
  const terminalRef = useRef<TerminalInstanceHandle>(null);
  const didSerializeRef = useRef(false);

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

  // If agent is stopped and has scrollback, show read-only terminal
  if (isStopped && scrollbackContent) {
    return (
      <div className="relative flex h-full flex-col">
        {/* Read-only banner */}
        <div className="flex shrink-0 items-center gap-2 bg-yellow-500/10 px-3 py-1.5 text-[11px]">
          <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-yellow-200/80">Session ended — read-only</span>
          {agent && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-[11px]"
              onClick={() =>
                spawnAgent.mutate({
                  projectId: agent.projectId,
                  cliType: agent.cliType,
                  taskDescription: agent.taskDescription,
                })
              }
            >
              <RotateCcw className="h-3 w-3" />
              Re-launch
            </Button>
          )}
        </div>
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
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-text-muted">Loading session history...</span>
        </div>
      );
    }
    // No scrollback available
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <AlertCircle className="h-6 w-6 text-text-muted" />
        <span className="text-sm text-text-muted">Session ended — no history available</span>
      </div>
    );
  }

  // Live terminal
  return <TerminalInstance ref={terminalRef} key={agentId} agentId={agentId} onReady={onReady} />;
}
