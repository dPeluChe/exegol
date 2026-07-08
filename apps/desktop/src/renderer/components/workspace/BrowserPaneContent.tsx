import { RUNNING_STATUSES } from "@exegol/shared";
import { Globe, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import {
  type PortInfo,
  usePreferredPort,
  useProjectPorts,
  useSetPreferredPort,
} from "../../hooks/use-trpc-scheduler";
import { buildDesignIssue } from "../../lib/design-capture";
import { useAgentStore } from "../../stores/agents";
import type { Pane } from "../../stores/workspace";
import { useWorkspaceStore } from "../../stores/workspace";
import { IssueBubble } from "../common/IssueBubble";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserQaRecordingBar } from "./BrowserQaRecordingBar";
import { BrowserReplayResultBar } from "./BrowserReplayResultBar";
import { useBrowserQa } from "./use-browser-qa";

// ─── Browser Pane ──────────────────────────────────────────────────────────

export function BrowserPane({ pane, paneId }: { pane: Pane; paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { data: ports } = useProjectPorts(project?.path ?? null);
  const { data: preferredPort } = usePreferredPort(projectId);
  const setPreferred = useSetPreferredPort();
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);

  // Deduplicate ports, prefer runtime over config
  const uniquePorts = useMemo(() => {
    if (!ports) return [];
    const map = new Map<number, PortInfo>();
    for (const p of ports) {
      const existing = map.get(p.port);
      if (!existing || (p.source === "runtime" && existing.source === "config")) {
        map.set(p.port, p);
      }
    }
    return Array.from(map.values());
  }, [ports]);

  const initUrl = pane.url ?? "http://localhost:3000";
  const [urlInput, setUrlInput] = useState(initUrl);
  const [currentUrl, setCurrentUrl] = useState(initUrl);
  const [didAutoSync, setDidAutoSync] = useState(!!pane.url);
  const webviewRef = useRef<HTMLElement | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadError, setLoadError] = useState<{ code: number; desc: string } | null>(null);
  const [issueMessage, setIssueMessage] = useState("");
  const allAgents = useAgentStore((s) => s.agents);
  const runningAgents = useMemo(
    () =>
      Object.values(allAgents).filter(
        (a) => a.projectId === projectId && RUNNING_STATUSES.has(a.status),
      ),
    [allAgents, projectId],
  );

  const {
    designMode,
    qaMode,
    capturedElement,
    setCapturedElement,
    qaRecording,
    setQaRecording,
    replayResult,
    setReplayResult,
    replaying,
    replayStep,
    savingTest,
    testName,
    setTestName,
    setSavedTestId,
    stopOnFail,
    setStopOnFail,
    qaActionCount,
    toggleDesignMode,
    toggleQaMode,
    handleSaveTest,
    handleReplay,
    cancelReplay,
  } = useBrowserQa({
    paneId,
    paneInternalId: pane.id,
    projectId,
    currentUrl,
    setUrlInput,
    setCurrentUrl,
    updatePane,
  });

  const sendToAgent = useCallback((agentId: string, text: string) => {
    window.api.terminal.write(agentId, `${text}\n`);
  }, []);

  // Track navigation history availability + load-failure state on the webview
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach listeners when URL changes
  useEffect(() => {
    const webview = webviewRef.current as unknown as {
      addEventListener: (e: string, fn: (ev: Event) => void) => void;
      removeEventListener: (e: string, fn: (ev: Event) => void) => void;
      canGoBack: () => boolean;
      canGoForward: () => boolean;
    } | null;
    if (!webview) return;
    const update = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        /* webview not ready */
      }
    };
    const onFailLoad = (ev: Event) => {
      const e = ev as unknown as {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      if (e.isMainFrame) {
        setLoadError({ code: e.errorCode, desc: e.errorDescription });
      }
    };
    const onStartLoad = () => setLoadError(null);
    webview.addEventListener("did-navigate", update as (ev: Event) => void);
    webview.addEventListener("did-navigate-in-page", update as (ev: Event) => void);
    webview.addEventListener("did-finish-load", update as (ev: Event) => void);
    webview.addEventListener("did-fail-load", onFailLoad);
    webview.addEventListener("did-start-loading", onStartLoad);
    return () => {
      webview.removeEventListener("did-navigate", update as (ev: Event) => void);
      webview.removeEventListener("did-navigate-in-page", update as (ev: Event) => void);
      webview.removeEventListener("did-finish-load", update as (ev: Event) => void);
      webview.removeEventListener("did-fail-load", onFailLoad);
      webview.removeEventListener("did-start-loading", onStartLoad);
    };
  }, [currentUrl]);

  const handleBack = useCallback(() => {
    const wv = webviewRef.current as unknown as { goBack?: () => void } | null;
    wv?.goBack?.();
  }, []);
  const handleForward = useCallback(() => {
    const wv = webviewRef.current as unknown as { goForward?: () => void } | null;
    wv?.goForward?.();
  }, []);
  const handleReload = useCallback(() => {
    const wv = webviewRef.current as unknown as { reload?: () => void } | null;
    wv?.reload?.();
  }, []);
  const handleOpenDevTools = useCallback(() => {
    const wv = webviewRef.current as unknown as {
      isDevToolsOpened?: () => boolean;
      openDevTools?: () => void;
      closeDevTools?: () => void;
    } | null;
    if (wv?.isDevToolsOpened?.()) wv.closeDevTools?.();
    else wv?.openDevTools?.();
  }, []);

  // Auto-sync to preferred or first detected port on initial load (once)
  useEffect(() => {
    if (didAutoSync) return;
    const port =
      preferredPort ??
      uniquePorts.find((p) => p.source === "runtime")?.port ??
      uniquePorts[0]?.port;
    if (port) {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
      setDidAutoSync(true);
    }
  }, [didAutoSync, preferredPort, uniquePorts, pane.id, updatePane]);

  const navigate = useCallback(() => {
    let url = urlInput.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    setCurrentUrl(url);
    updatePane(pane.id, { url });
  }, [urlInput, pane.id, updatePane]);

  const navigateToPort = useCallback(
    (port: number) => {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
    },
    [pane.id, updatePane],
  );

  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div role="none" className="flex h-full flex-col" onMouseDown={() => setFocusedPane(paneId)}>
      <BrowserAddressBar
        urlInput={urlInput}
        currentUrl={currentUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        designMode={designMode}
        qaMode={qaMode}
        qaActionCount={qaActionCount}
        uniquePorts={uniquePorts}
        projectId={projectId}
        preferredPort={preferredPort}
        setUrlInputValue={setUrlInput}
        onFocus={() => setFocusedPane(paneId)}
        onNavigate={navigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onOpenDevTools={handleOpenDevTools}
        onToggleDesignMode={toggleDesignMode}
        onToggleQaMode={toggleQaMode}
        onNavigateToPort={navigateToPort}
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
        {loadError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-primary/95 p-4 text-center">
            <Globe className="h-8 w-8 text-text-muted/60" />
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-text-primary">
                Can't reach {new URL(currentUrl).host}
              </div>
              <div className="max-w-sm text-[10px] text-text-muted">
                {loadError.desc} ({loadError.code}). Is your dev server running? Try starting it and
                click Retry, or enter a different URL above.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="flex items-center gap-1 rounded border border-border bg-bg-secondary px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <RotateCw className="h-3 w-3" />
                Retry
              </button>
              {uniquePorts.length > 0 && (
                <span className="text-[10px] text-text-muted">
                  Or pick a port from the bar above
                </span>
              )}
            </div>
          </div>
        )}
        {!isFocused && (
          <div
            role="none"
            className="absolute inset-0 z-10"
            onMouseDown={() => setFocusedPane(paneId)}
          />
        )}

        {/* T102: Design Mode — floating issue reporter bubble */}
        {capturedElement && (
          <IssueBubble
            element={capturedElement}
            message={issueMessage}
            onMessageChange={setIssueMessage}
            agents={runningAgents}
            onSend={(agentId) => {
              sendToAgent(agentId, buildDesignIssue(capturedElement, issueMessage));
              setCapturedElement(null);
              setIssueMessage("");
            }}
            onCopy={() => {
              navigator.clipboard.writeText(buildDesignIssue(capturedElement, issueMessage));
              setCapturedElement(null);
              setIssueMessage("");
            }}
            onDismiss={() => {
              setCapturedElement(null);
              setIssueMessage("");
            }}
          />
        )}
      </div>

      {qaRecording && (
        <BrowserQaRecordingBar
          qaRecording={qaRecording}
          replaying={replaying}
          replayStep={replayStep}
          stopOnFail={stopOnFail}
          testName={testName}
          savingTest={savingTest}
          projectId={projectId}
          runningAgents={runningAgents}
          onReplay={() => handleReplay()}
          onCancelReplay={cancelReplay}
          onSendToAgent={sendToAgent}
          onSetStopOnFail={setStopOnFail}
          onSetTestName={setTestName}
          onSaveTest={handleSaveTest}
          onDismiss={() => {
            setQaRecording(null);
            setReplayResult(null);
            setSavedTestId(null);
          }}
        />
      )}

      {replayResult && (
        <BrowserReplayResultBar
          replayResult={replayResult}
          onDismiss={() => setReplayResult(null)}
        />
      )}
    </div>
  );
}
