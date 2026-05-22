import type { Agent, HandoffSummary } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { AlertCircle, ArrowRight, Play, RotateCcw } from "lucide-react";
import type { Ref } from "react";
import { useCallback } from "react";
import { useSpawnAgent } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentStopReason } from "./AgentStopReason";
import { ChatView } from "./ChatView";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";
import { TerminalViewToggle } from "./TerminalToolbar";

/** Subset of agent fields the scrollback view consumes. Compatible with both
 *  the DB `Agent` shape and the renderer-store `AgentState` shape. */
export type ScrollbackAgent = Pick<
  Agent,
  "id" | "projectId" | "cliType" | "status" | "taskDescription" | "branchName"
> & {
  accessMode?: Agent["accessMode"] | null;
  resumeCommand?: string | null;
};

interface TerminalScrollbackProps {
  agent: ScrollbackAgent | null;
  agentId: string;
  scrollbackContent: string;
  resolvedHandoff: HandoffSummary | null;
  resumableCliTypes: Set<string>;
  paneId?: string;
  viewMode: "terminal" | "chat";
  setViewMode: (mode: "terminal" | "chat") => void;
  handoffLoading: boolean;
  onContinueWithHandoff: () => void;
  terminalRef: Ref<TerminalInstanceHandle>;
  onScrollPosition: (atTop: boolean, atBottom: boolean) => void;
  floatingButtons: React.ReactNode;
}

/**
 * Read-only terminal view shown after an agent stops/crashes. Replays the
 * stored scrollback in a non-interactive xterm and exposes resume / handoff
 * continuation actions.
 */
export function TerminalScrollback({
  agent,
  agentId,
  scrollbackContent,
  resolvedHandoff,
  resumableCliTypes,
  paneId,
  viewMode,
  setViewMode,
  handoffLoading,
  onContinueWithHandoff,
  terminalRef,
  onScrollPosition,
  floatingButtons,
}: TerminalScrollbackProps) {
  const spawnAgent = useSpawnAgent();
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);

  const handleResume = useCallback(async () => {
    if (!agent) return;
    const canResume = resumableCliTypes.has(agent.cliType);
    const newAgent = await spawnAgent.mutateAsync({
      projectId: agent.projectId,
      cliType: agent.cliType,
      taskDescription: agent.taskDescription,
      useWorktree: !!agent.branchName,
      branchName: agent.branchName ?? undefined,
      resumeSession: canResume,
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
        activityLevel: "busy",
      });
      createTerminal(newAgent.id);
      useWorkspaceStore.getState().updatePane(paneId, {
        type: "terminal",
        agentId: newAgent.id,
      });
    }
  }, [agent, paneId, resumableCliTypes, spawnAgent, addAgent, removeAgent, createTerminal]);

  const canResume = agent ? resumableCliTypes.has(agent.cliType) : false;
  const ResumeIcon = canResume ? Play : RotateCcw;
  const resumeLabel = canResume ? "Resume" : "Re-launch";
  const isCrashed = agent?.status === "crashed";

  return (
    <div className="relative flex h-full flex-col">
      <div
        className={`relative flex shrink-0 items-center px-3 py-1.5 text-[11px] ${isCrashed ? "bg-red-500/10" : "bg-yellow-500/10"}`}
      >
        <div className="flex items-center gap-1.5">
          <AlertCircle
            className={`h-3.5 w-3.5 shrink-0 ${isCrashed ? "text-red-400" : "text-yellow-400"}`}
          />
          <span className={isCrashed ? "text-red-200/80" : "text-yellow-200/80"}>
            {isCrashed ? "Crashed" : "Ended"}
          </span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none">
          {agent && (
            <Button
              variant="ghost"
              size="sm"
              className="pointer-events-auto h-6 gap-1 rounded-md border border-accent/30 px-2 text-[10px] text-accent hover:bg-accent/10"
              onClick={handleResume}
            >
              <ResumeIcon className="h-3 w-3" />
              {resumeLabel}
            </Button>
          )}
          {resolvedHandoff && (
            <Button
              variant="ghost"
              size="sm"
              className="pointer-events-auto h-6 gap-1 rounded-md border border-border px-2 text-[10px] text-text-secondary hover:bg-white/5"
              onClick={onContinueWithHandoff}
              disabled={handoffLoading}
            >
              <ArrowRight className="h-3 w-3" />
              {handoffLoading ? "..." : "Continue"}
            </Button>
          )}
        </div>
        <TerminalViewToggle
          viewMode={viewMode}
          onToggle={() => setViewMode(viewMode === "terminal" ? "chat" : "terminal")}
          className="ml-auto"
        />
      </div>
      {resolvedHandoff && (
        <div className="shrink-0 border-b border-border bg-blue-500/5 px-3 py-2">
          <p className="text-[10px] font-medium text-blue-300">Handoff available</p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Goal: {resolvedHandoff.goal.slice(0, 100)}
            {resolvedHandoff.goal.length > 100 ? "..." : ""}
          </p>
        </div>
      )}
      {agent && (
        <AgentStopReason
          agent={agent}
          scrollback={scrollbackContent}
          onResume={canResume && agent.resumeCommand ? handleResume : undefined}
          onSpawnNew={(task) => {
            window.dispatchEvent(
              new CustomEvent("exegol:spawn-agent", {
                detail: { taskDescription: task, cliType: agent.cliType },
              }),
            );
          }}
          onViewDiff={(aid) => {
            window.dispatchEvent(new CustomEvent("exegol:view-diff", { detail: { agentId: aid } }));
          }}
        />
      )}
      <div className="relative flex-1">
        {viewMode === "chat" ? (
          <ChatView scrollback={scrollbackContent} cliType={agent?.cliType} />
        ) : (
          <>
            <TerminalInstance
              ref={terminalRef}
              key={`scrollback-${agentId}`}
              agentId={agentId}
              cliType={agent?.cliType}
              readOnly
              initialContent={scrollbackContent}
              onScrollPosition={onScrollPosition}
            />
            {floatingButtons}
          </>
        )}
      </div>
    </div>
  );
}
