import type { Agent } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { ArrowUpCircle, ChevronDown, RotateCcw } from "lucide-react";
import type { Ref } from "react";
import { useCallback, useState } from "react";
import { selfUpdateTitle } from "../../hooks/use-cli-updates";
import { useEnabledProviders } from "../../hooks/use-providers";
import { useResumeAgent } from "../../hooks/use-resume-agent";
import { type CliSelfUpdate, useCliSelfUpdateStore } from "../../stores/cli-self-updates";
import { ChatView } from "./ChatView";
import { EndedSessionLauncher } from "./EndedSessionLauncher";
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
  alias?: string | null;
  /** Launch choices a new session in the same place keeps */
  model?: string | null;
  modelRoles?: Record<string, string> | null;
  yolo?: boolean | null;
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
 * An agent that stopped or crashed: the ended-session launcher, and the stored
 * scrollback in a non-interactive xterm one click below it.
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
  const toggleView = () => setViewMode(viewMode === "terminal" ? "chat" : "terminal");
  const updated = useCliSelfUpdateStore((s) => s.byAgent[agentId]);
  // A failed or crashed session keeps its exit look, whatever the CLI version did
  const selfUpdate =
    agent && agent.status !== "failed" && agent.status !== "crashed" ? updated : undefined;

  return (
    <div className="relative flex h-full flex-col">
      {selfUpdate && (
        <SelfUpdateBar
          selfUpdate={selfUpdate}
          pending={pending}
          onRestart={handleResume}
          viewMode={viewMode}
          onToggleView={toggleView}
        />
      )}
      {/* Ended sessions start with a CLEAN pane (verify session 2026-08-11): the launcher, the
          output one click away */}
      <div
        className={
          showOutput
            ? "max-h-[55%] shrink-0 overflow-y-auto border-b border-border"
            : "@container-[size] flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto"
        }
      >
        {agent && (
          <EndedSessionLauncher
            agent={agent}
            paneId={paneId}
            canResume={canResume}
            pending={pending}
            onResume={handleResume}
            hidePrimary={!!selfUpdate}
          />
        )}
        <div className="flex items-center justify-center gap-2 pb-3">
          <button
            type="button"
            onClick={() => setShowOutput(!showOutput)}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            <ChevronDown className={cn("h-3 w-3", showOutput && "rotate-180")} />
            {showOutput ? "Hide session output" : "Show session output"}
          </button>
          {showOutput && !selfUpdate && (
            <TerminalViewToggle viewMode={viewMode} onToggle={toggleView} />
          )}
        </div>
      </div>
      {showOutput && (
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

/** The CLI ended to finish its own update: restart on the new version */
function SelfUpdateBar({
  selfUpdate,
  pending,
  onRestart,
  viewMode,
  onToggleView,
}: {
  selfUpdate: CliSelfUpdate;
  pending: boolean;
  onRestart: () => void;
  viewMode: "terminal" | "chat";
  onToggleView: () => void;
}) {
  const providers = useEnabledProviders();
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
        onClick={onRestart}
        disabled={pending}
      >
        <RotateCcw className="h-3 w-3" />
        Restart session
      </Button>
      <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} className="ml-auto" />
    </div>
  );
}
