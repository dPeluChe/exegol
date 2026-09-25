import type { Agent } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { AlertCircle, ChevronDown, Play, RotateCcw } from "lucide-react";
import type { Ref } from "react";
import { useCallback, useState } from "react";
import { useResumeAgent } from "../../hooks/use-resume-agent";
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
  /** Last scraped line — the only readable trace of why a spawn died. */
  currentStep?: string | null;
};

interface TerminalScrollbackProps {
  agent: ScrollbackAgent | null;
  agentId: string;
  scrollbackContent: string;
  resumableCliTypes: Set<string>;
  paneId?: string;
  viewMode: "terminal" | "chat";
  setViewMode: (mode: "terminal" | "chat") => void;
  terminalRef: Ref<TerminalInstanceHandle>;
  onScrollPosition: (atTop: boolean, atBottom: boolean) => void;
  floatingButtons: React.ReactNode;
}

/**
 * Read-only terminal view shown after an agent stops/crashes. Replays the
 * stored scrollback in a non-interactive xterm and exposes the resume action.
 */
export function TerminalScrollback({
  agent,
  agentId,
  scrollbackContent,
  resumableCliTypes,
  paneId,
  viewMode,
  setViewMode,
  terminalRef,
  onScrollPosition,
  floatingButtons,
}: TerminalScrollbackProps) {
  const [showOutput, setShowOutput] = useState(false);
  const { resume } = useResumeAgent();
  const handleResume = useCallback(() => {
    if (agent) resume(agent, paneId).catch(() => {});
  }, [agent, paneId, resume]);

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
        </div>
        <TerminalViewToggle
          viewMode={viewMode}
          onToggle={() => setViewMode(viewMode === "terminal" ? "chat" : "terminal")}
          className="ml-auto"
        />
      </div>
      {agent && (
        <AgentStopReason
          agent={agent}
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
      {/* Ended sessions start with a CLEAN pane (verify session 2026-08-11) —
          the stale terminal below the card read as confusion. Output is one
          click away, and the Chat toggle still works when shown. */}
      {!showOutput ? (
        <div className="flex flex-1 items-start justify-center pt-6">
          <button
            type="button"
            onClick={() => setShowOutput(true)}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            <ChevronDown className="h-3 w-3" />
            Show session output
          </button>
        </div>
      ) : (
        // min-h-0: a flex item won't shrink below its content, so the grid set the box height
        <div className="relative min-h-0 flex-1">
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
      )}
    </div>
  );
}
