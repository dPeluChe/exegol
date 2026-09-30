import { useQueryClient } from "@tanstack/react-query";
import { Globe, RotateCw } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useLatest } from "../../hooks/use-latest";
import { type PortInfo, useSetPreferredPort } from "../../hooks/use-trpc-scheduler";
import { isPasteTarget } from "../../lib/agent-input";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import type { Pane } from "../../stores/workspace";
import { useWorkspaceStore } from "../../stores/workspace";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserQaRecordingBar } from "./BrowserQaRecordingBar";
import { BrowserReplayResultBar } from "./BrowserReplayResultBar";
import { DesignIssueBubble } from "./DesignIssueBubble";
import { useBrowserQa } from "./use-browser-qa";
import { useDevServerPorts } from "./use-dev-server-ports";
import { type LoadError, useWebviewControls, useWebviewNavState } from "./use-webview";

// ─── Browser Pane ──────────────────────────────────────────────────────────

/** The pane's URL: the saved one wins; until there is one, follow the project's dev server */
function usePaneUrl(pane: Pane, autoPort: number | undefined) {
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const currentUrl = pane.url ?? `http://localhost:${autoPort ?? 3000}`;
  // What the user is typing; null shows the page's URL
  const [draft, setDraft] = useState<string | null>(null);
  const urlInput = draft ?? currentUrl;
  const goTo = useCallback(
    (url: string) => {
      setDraft(null);
      updatePane(pane.id, { url });
    },
    [pane.id, updatePane],
  );
  // The first page that loads keeps its URL, so a server started later does not move it
  const keepAutoUrl = useLatest(() => {
    if (!pane.url) updatePane(pane.id, { url: currentUrl });
  });
  const navigate = useCallback(() => {
    let url = urlInput.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    goTo(url);
  }, [urlInput, goTo]);
  const navigateToPort = useCallback((port: number) => goTo(`http://localhost:${port}`), [goTo]);
  return { currentUrl, urlInput, setDraft, goTo, keepAutoUrl, navigate, navigateToPort };
}

function useRunningProjectAgents(projectId: string | null) {
  const allAgents = useAgentStore((s) => s.agents);
  return useMemo(
    () => Object.values(allAgents).filter((a) => a.projectId === projectId && isPasteTarget(a)),
    [allAgents, projectId],
  );
}

export function BrowserPane({ pane, paneId }: { pane: Pane; paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { uniquePorts, preferredPort, autoPort } = useDevServerPorts(
    project?.path ?? null,
    projectId,
  );
  const setPreferred = useSetPreferredPort();
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const { currentUrl, urlInput, setDraft, goTo, keepAutoUrl, navigate, navigateToPort } =
    usePaneUrl(pane, autoPort);
  const webviewRef = useRef<HTMLElement | null>(null);
  const { canGoBack, canGoForward, loadError } = useWebviewNavState(
    webviewRef,
    currentUrl,
    keepAutoUrl,
  );
  const { handleBack, handleForward, handleReload, handleOpenDevTools } =
    useWebviewControls(webviewRef);
  const [pendingStop, setPendingStop] = useState<PortInfo | null>(null);
  // The page could not reach this port: its chip turns red until a load succeeds
  const deadPort = loadError ? Number(currentUrl.match(/:(\d+)/)?.[1]) || null : null;
  const [issueMessage, setIssueMessage] = useState("");
  const runningAgents = useRunningProjectAgents(projectId);

  const qa = useBrowserQa({
    webviewRef,
    paneId,
    projectId,
    currentUrl,
    goTo,
  });

  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div role="none" className="flex h-full flex-col" onMouseDown={() => setFocusedPane(paneId)}>
      <BrowserAddressBar
        urlInput={urlInput}
        currentUrl={currentUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        designMode={qa.designMode}
        qaMode={qa.qaMode}
        qaActionCount={qa.qaActionCount}
        uniquePorts={uniquePorts}
        projectId={projectId}
        preferredPort={preferredPort}
        setUrlInputValue={setDraft}
        onFocus={() => setFocusedPane(paneId)}
        onNavigate={navigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onOpenDevTools={handleOpenDevTools}
        onToggleDesignMode={qa.toggleDesignMode}
        onToggleQaMode={qa.toggleQaMode}
        onNavigateToPort={navigateToPort}
        deadPort={deadPort}
        onStopPort={setPendingStop}
        onSetPreferredPort={(port) => {
          if (projectId) setPreferred.mutate({ projectId, port });
        }}
      />
      {/* Webview with focus capture overlay when not active */}
      <div className="relative flex-1">
        <webview
          // biome-ignore lint/suspicious/noExplicitAny: Electron webview not in TS DOM
          ref={webviewRef as React.Ref<any>}
          src={currentUrl}
          className="h-full w-full"
          /* @ts-expect-error Electron webview attributes */
          allowpopups="true"
        />
        <StopServerDialog pendingStop={pendingStop} onDone={() => setPendingStop(null)} />
        {loadError && (
          <LoadErrorOverlay
            currentUrl={currentUrl}
            loadError={loadError}
            hasPorts={uniquePorts.length > 0}
            onRetry={handleReload}
          />
        )}
        {!isFocused && (
          <div
            role="none"
            className="absolute inset-0 z-10"
            onMouseDown={() => setFocusedPane(paneId)}
          />
        )}

        {qa.capturedElement && (
          <DesignIssueBubble
            element={qa.capturedElement}
            message={issueMessage}
            onMessageChange={setIssueMessage}
            agents={runningAgents}
            onClear={() => {
              qa.setCapturedElement(null);
              setIssueMessage("");
            }}
          />
        )}
      </div>

      {qa.qaRecording && (
        <BrowserQaRecordingBar
          qaRecording={qa.qaRecording}
          replaying={qa.replaying}
          replayStep={qa.replayStep}
          stopOnFail={qa.stopOnFail}
          testName={qa.testName}
          savingTest={qa.savingTest}
          projectId={projectId}
          runningAgents={runningAgents}
          onReplay={() => qa.handleReplay()}
          onCancelReplay={qa.cancelReplay}
          onSetStopOnFail={qa.setStopOnFail}
          onSetTestName={qa.setTestName}
          onSaveTest={qa.handleSaveTest}
          onDismiss={() => {
            qa.setQaRecording(null);
            qa.setReplayResult(null);
            qa.setSavedTestId(null);
          }}
        />
      )}

      {qa.replayResult && (
        <BrowserReplayResultBar
          replayResult={qa.replayResult}
          onDismiss={() => qa.setReplayResult(null)}
        />
      )}
    </div>
  );
}

function StopServerDialog({
  pendingStop,
  onDone,
}: {
  pendingStop: PortInfo | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  return (
    <ConfirmDialog
      open={!!pendingStop}
      onOpenChange={(open) => !open && onDone()}
      title={`Stop the server on :${pendingStop?.port ?? ""}?`}
      description={`${pendingStop && "process" in pendingStop ? pendingStop.process : "The process"} (pid ${pendingStop && "pid" in pendingStop ? pendingStop.pid : "?"}) gets SIGTERM, then SIGKILL if it is still running after 3 seconds. Useful when its terminal was closed but the server kept running.`}
      confirmLabel="Stop"
      variant="destructive"
      onConfirm={() => {
        if (!pendingStop || !("pid" in pendingStop)) return;
        trpcMutate("resources.killDevServer", { pid: pendingStop.pid })
          .catch((err) => console.error("[Browser] Stop failed:", err))
          .finally(() => queryClient.invalidateQueries({ queryKey: ["resources"] }));
      }}
    />
  );
}

function LoadErrorOverlay({
  currentUrl,
  loadError,
  hasPorts,
  onRetry,
}: {
  currentUrl: string;
  loadError: LoadError;
  hasPorts: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-primary/95 p-4 text-center">
      <Globe className="h-8 w-8 text-text-muted/60" />
      <div className="space-y-0.5">
        <div className="text-xs font-medium text-text-primary">
          Can't reach {new URL(currentUrl).host}
        </div>
        <div className="max-w-sm text-[10px] text-text-muted">
          {loadError.desc} ({loadError.code}). Is your dev server running? Try starting it and click
          Retry, or enter a different URL above.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 rounded border border-border bg-bg-secondary px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
        {hasPorts && (
          <span className="text-[10px] text-text-muted">Or pick a port from the bar above</span>
        )}
      </div>
    </div>
  );
}
