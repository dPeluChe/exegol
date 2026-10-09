import type { Agent } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { AlertCircle, ArrowUpCircle, ChevronDown, Play, RotateCcw } from "lucide-react";
import type { Ref } from "react";
import { useCallback, useState } from "react";
import { selfUpdateTitle } from "../../hooks/use-cli-updates";
import { useEnabledProviders } from "../../hooks/use-providers";
import { useResumeAgent } from "../../hooks/use-resume-agent";
import { type CliSelfUpdate, useCliSelfUpdateStore } from "../../stores/cli-self-updates";
import { AgentStopReason } from "./AgentStopReason";
import { ChatView } from "./ChatView";
import { TerminalLinkPeek } from "./FilesPeek";
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
  /** Stopped on purpose with Suspend: nothing went wrong */
  suspended?: boolean;
};

interface TerminalScrollbackProps {
  agent: ScrollbackAgent | null;
  agentId: string;
  scrollbackContent: string;
  paneId?: string;
  viewMode: "terminal" | "chat";
  setViewMode: (mode: "terminal" | "chat") => void;
  terminalRef: Ref<TerminalInstanceHandle>;
  onScrollPosition: (atTop: boolean, atBottom: boolean) => void;
  floatingButtons: React.ReactNode;
  onSelectionChange?: (hasSelection: boolean) => void;
}

/**
 * Read-only terminal view shown after an agent stops/crashes. Replays the
 * stored scrollback in a non-interactive xterm and exposes the resume action.
 */
export function TerminalScrollback({
  agent,
  agentId,
  scrollbackContent,
  paneId,
  viewMode,
  setViewMode,
  terminalRef,
  onScrollPosition,
  floatingButtons,
  onSelectionChange,
}: TerminalScrollbackProps) {
  const [showOutput, setShowOutput] = useState(false);
  const { resume, pending, resumableCliTypes } = useResumeAgent();
  // One click, one agent: a double-click spawned two
  const handleResume = useCallback(() => {
    if (agent && !pending) resume(agent, paneId).catch(() => {});
  }, [agent, paneId, pending, resume]);

  const canResume = agent ? resumableCliTypes.has(agent.cliType) : false;
  const selfUpdate = useCliSelfUpdateStore((s) => s.byAgent[agentId]);

  return (
    <div className="relative flex h-full flex-col">
      <ScrollbackStatusBar
        agent={agent}
        canResume={canResume}
        selfUpdate={selfUpdate}
        pending={pending}
        onResume={handleResume}
        viewMode={viewMode}
        onToggleView={() => setViewMode(viewMode === "terminal" ? "chat" : "terminal")}
      />
      {/* Updated, not failed: no exit card */}
      {agent && !selfUpdate && (
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
                onSelectionChange={onSelectionChange}
              />
              {floatingButtons}
            </>
          )}
          <TerminalLinkPeek agentId={agentId} />
        </div>
      )}
    </div>
  );
}

/** Crashed / Ended / Suspended strip with the resume action and the view toggle */
function ScrollbackStatusBar({
  agent,
  canResume,
  selfUpdate,
  pending,
  onResume,
  viewMode,
  onToggleView,
}: {
  agent: ScrollbackAgent | null;
  canResume: boolean;
  selfUpdate?: CliSelfUpdate;
  pending: boolean;
  onResume: () => void;
  viewMode: "terminal" | "chat";
  onToggleView: () => void;
}) {
  const ResumeIcon = canResume ? Play : RotateCcw;
  const resumeLabel = canResume ? "Resume" : "Re-launch";
  const isCrashed = agent?.status === "crashed";
  const providers = useEnabledProviders();

  if (selfUpdate && agent) {
    const name = providers.find((p) => p.id === selfUpdate.cliType)?.name ?? selfUpdate.cliType;
    return (
      <div className="relative flex shrink-0 items-center gap-2 bg-accent/10 px-3 py-1.5 text-[11px]">
        <ArrowUpCircle className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-text-primary">{selfUpdateTitle(name, selfUpdate.to)}</span>
        <span className="text-text-muted">
          (was {selfUpdate.from}): it ended to finish the update
        </span>
        <Button
          size="sm"
          className="h-6 gap-1 rounded-md bg-accent px-2 text-[10px] text-white hover:bg-accent/90"
          onClick={onResume}
          disabled={pending}
        >
          <RotateCcw className="h-3 w-3" />
          Restart session
        </Button>
        <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} className="ml-auto" />
      </div>
    );
  }

  return (
    <div
      className={`relative flex shrink-0 items-center px-3 py-1.5 text-[11px] ${isCrashed ? "bg-red-500/10" : "bg-yellow-500/10"}`}
    >
      <div className="flex items-center gap-1.5">
        <AlertCircle
          className={`h-3.5 w-3.5 shrink-0 ${isCrashed ? "text-red-400" : "text-yellow-400"}`}
        />
        <span className={isCrashed ? "text-red-200/80" : "text-yellow-200/80"}>
          {isCrashed ? "Crashed" : agent?.suspended ? "Suspended: Resume to continue" : "Ended"}
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none">
        {agent && (
          <Button
            variant="ghost"
            size="sm"
            className="pointer-events-auto h-6 gap-1 rounded-md border border-accent/30 px-2 text-[10px] text-accent hover:bg-accent/10"
            onClick={onResume}
            disabled={pending}
          >
            <ResumeIcon className="h-3 w-3" />
            {resumeLabel}
          </Button>
        )}
      </div>
      <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} className="ml-auto" />
    </div>
  );
}
