import { deriveIsolationMode } from "@exegol/shared";
import { AlertCircle } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useResumeAgent } from "../../hooks/use-resume-agent";
import { useAgent, useStopAgent } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { getProjectState, layoutHasPane, useWorkspaceStore } from "../../stores/workspace";
import { EmptyState, LoadingSpinner } from "../common";
import { ChatView } from "./ChatView";
import { FilesPeek, PeekFileOverlay } from "./FilesPeek";
import { TerminalFloatingButtons } from "./TerminalFloatingButtons";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";
import { type ScrollbackAgent, TerminalScrollback } from "./TerminalScrollback";
import { LiveStartOverlay, TerminalToolbar } from "./TerminalToolbar";
import { useOpenShellHere } from "./use-open-shell-here";
import { useTerminalGitInfo } from "./use-terminal-git-info";
import { useTerminalLifecycle } from "./use-terminal-lifecycle";
import {
  useFilesPeek,
  useLiveViewMode,
  useLocalhostPreview,
  useSendTo,
} from "./use-terminal-panel-actions";
import { useTerminalScrollState } from "./use-terminal-scroll-state";

interface TerminalPanelProps {
  agentId: string;
  paneId?: string;
  onReady?: () => void;
}

export function TerminalPanel({ agentId, paneId, onReady }: TerminalPanelProps) {
  // Use push-driven store for instant status updates (not 30s polling)
  const { projectId: activeProjectId } = useProjectContext();
  const { storeAgent, isolationMode, agent } = usePanelAgent(agentId);
  const { scrollAtTop, scrollAtBottom, hasNewOutput, handleScrollPosition } =
    useTerminalScrollState();
  const terminalRef = useRef<TerminalInstanceHandle>(null);
  const { sendGroups, showSendTo, setShowSendTo, handleSendTo, onSelectionChange } = useSendTo(
    agentId,
    storeAgent?.projectId ?? activeProjectId ?? undefined,
    terminalRef,
  );
  const { viewMode, setViewMode, liveSnapshot, toggleLiveView } = useLiveViewMode(terminalRef);
  const stopAgent = useStopAgent();
  const resumeAgent = useResumeAgent();
  const { hasData, startTimedOut, isStopped, scrollbackContent, scrollbackLoading } =
    useTerminalLifecycle({ agentId, status: agent?.status });

  const toolbarProjectId = agent?.projectId ?? activeProjectId ?? undefined;
  const gitInfo = useTerminalGitInfo(toolbarProjectId, agent?.branchName);
  const filesPeek = useFilesPeek(toolbarProjectId);
  const agentProjectId = agent?.projectId;
  // T155: Cmd+click on a file path in the terminal → open in the IDE at line
  const handleOpenFileLink = useCallback(
    (path: string, line?: number) => {
      if (!agentProjectId) return;
      trpcMutate("projects.openInIde", {
        projectId: agentProjectId,
        file: path,
        line,
        agentId,
      }).catch(() => {});
    },
    [agentProjectId, agentId],
  );
  const handleOpenShellHere = useOpenShellHere({
    agentId,
    paneId,
    agentProjectId,
    activeProjectId,
    stopAgent,
  });
  // A browser pane beside this one: Cmd+click on a URL (T155), the preview chip, the repo button
  const openBesideInBrowser = useCallback(
    (url: string) => {
      if (!paneId) return;
      const tab = getProjectState().tabs.find((t) => layoutHasPane(t.layout, paneId));
      if (tab) {
        useWorkspaceStore.getState().splitPane(tab.id, paneId, "vertical", "browser", { url });
      }
    },
    [paneId],
  );

  usePersistSerializedOnStop(agentId, isStopped, terminalRef);

  const preview = useLocalhostPreview(agentId, !isStopped, openBesideInBrowser);

  const floatingButtons = (
    <TerminalFloatingButtons
      terminalRef={terminalRef}
      scrollAtTop={scrollAtTop}
      scrollAtBottom={scrollAtBottom}
      hasNewOutput={hasNewOutput}
      sendGroups={sendGroups}
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
        paneId={paneId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        terminalRef={terminalRef}
        onScrollPosition={handleScrollPosition}
        floatingButtons={floatingButtons}
        onSelectionChange={onSelectionChange}
      />
    );
  }

  // If stopped with no scrollback yet (loading or no data)
  if (isStopped && !scrollbackContent) {
    return (
      <SessionEndedState
        agent={agent}
        paneId={paneId}
        loading={scrollbackLoading}
        resumeAgent={resumeAgent}
      />
    );
  }

  // Live terminal — show loading overlay until first data arrives
  return (
    // Capture phase: with Files or a peeked file open, Esc closes it before the CLI sees it;
    // with both closed Esc reaches the terminal as always (a dialog handles its own)
    <div
      className="relative flex h-full flex-col"
      onKeyDownCapture={(e) => {
        if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
        if (filesPeek.escape()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {!hasData && (
        <LiveStartOverlay
          cliType={agent?.cliType}
          timedOut={startTimedOut}
          onDismiss={() => stopAgent.mutate(agentId)}
          onOpenTerminal={handleOpenShellHere}
        />
      )}
      {hasData && (
        <TerminalToolbar
          agent={storeAgent ?? null}
          accessMode={agent?.accessMode}
          isolationMode={isolationMode}
          branchName={gitInfo.branchName}
          dirtyCount={gitInfo.dirtyCount}
          viewMode={viewMode}
          onToggleView={toggleLiveView}
          preview={preview}
          repoUrl={gitInfo.repoUrl}
          onOpenRepo={openBesideInBrowser}
          filesOpen={filesPeek.filesOpen}
          onToggleFiles={filesPeek.toggleFiles}
        />
      )}
      {/* min-h-0: a flex item never shrinks below its content by default, so the
          terminal's own rows set the box height and each fit stepped it down a row */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
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
                onOpenFileLink={handleOpenFileLink}
                onOpenUrlInPane={openBesideInBrowser}
                onSelectionChange={onSelectionChange}
              />
              {floatingButtons}
            </>
          )}
          {filesPeek.peekFile && (
            <PeekFileOverlay
              path={filesPeek.peekFile}
              onClose={filesPeek.closeFile}
              onDirtyChange={filesPeek.setFileDirty}
            />
          )}
        </div>
        {filesPeek.filesOpen && filesPeek.peekProject && (
          <FilesPeek
            projectId={filesPeek.peekProject.id}
            rootPath={filesPeek.peekProject.path}
            onOpenFile={filesPeek.openFile}
            onClose={filesPeek.closeFiles}
          />
        )}
      </div>
    </div>
  );
}

/** Prefer store (push events) over DB query (polling fallback). Merge in
 *  dbAgent-only fields (resumeCommand) so T106 Resume gating works even
 *  when the push-event store is the source for the rest of the shape. */
function usePanelAgent(agentId: string) {
  const storeAgent = useAgentStore((s) => s.agents[agentId]);
  const { data: dbAgent } = useAgent(agentId);
  const agent = useMemo(() => {
    if (!storeAgent) return dbAgent ?? null;
    return { ...storeAgent, resumeCommand: dbAgent?.resumeCommand ?? null };
  }, [storeAgent, dbAgent]);
  return {
    storeAgent,
    isolationMode: dbAgent ? deriveIsolationMode(dbAgent) : null,
    agent,
  };
}

/** When the agent stops, serialize the terminal state once and persist it */
function usePersistSerializedOnStop(
  agentId: string,
  isStopped: boolean,
  terminalRef: RefObject<TerminalInstanceHandle | null>,
) {
  const didSerializeRef = useRef(false);

  const persistSerializedState = useCallback(() => {
    if (didSerializeRef.current) return;
    const serialized = terminalRef.current?.serialize();
    if (!serialized) return;
    didSerializeRef.current = true;
    trpcMutate("scrollback.saveSerialized", { agentId, content: serialized }).catch(() => {
      // Non-fatal: raw scrollback still available as fallback
    });
  }, [agentId, terminalRef]);

  useEffect(() => {
    if (isStopped) {
      persistSerializedState();
    }
  }, [isStopped, persistSerializedState]);
}

/** Stopped with no saved history (or still loading it): a restart that killed the sidecar before
 *  history was saved landed here with no way back, so offer Resume/Re-launch */
function SessionEndedState({
  agent,
  paneId,
  loading,
  resumeAgent,
}: {
  agent: ScrollbackAgent | null;
  paneId: string | undefined;
  loading: boolean;
  resumeAgent: ReturnType<typeof useResumeAgent>;
}) {
  const { resume, pending, resumableCliTypes } = resumeAgent;
  if (loading) {
    return <LoadingSpinner label="Loading session history..." className="h-full" />;
  }
  const crashed = agent?.status === "crashed";
  return (
    <EmptyState
      icon={<AlertCircle className="h-6 w-6 text-text-muted" />}
      title={crashed ? "Session lost" : "Session ended"}
      description={
        crashed
          ? "It was interrupted (app or system restart) before its history was saved"
          : "No history available"
      }
      action={
        agent
          ? {
              label: pending
                ? "Starting..."
                : resumableCliTypes.has(agent.cliType)
                  ? "Resume"
                  : "Re-launch",
              onClick: () => {
                if (!pending) resume(agent, paneId).catch(() => {});
              },
            }
          : undefined
      }
      className="h-full"
    />
  );
}
