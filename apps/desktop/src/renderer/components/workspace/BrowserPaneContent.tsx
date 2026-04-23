import { cn } from "@exegol/ui";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CheckCircle,
  Crosshair,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import {
  type PortInfo,
  usePreferredPort,
  useProjectPorts,
  useSetPreferredPort,
} from "../../hooks/use-trpc-scheduler";
import {
  type CapturedElement,
  DESIGN_MODE_INJECTION_SCRIPT,
  formatElementForAgent,
} from "../../lib/design-capture";
import {
  exportToPlaywright,
  formatRecordingForAgent,
  QA_MODE_INJECTION_SCRIPT,
  type QaRecording,
} from "../../lib/qa-recorder";
import { type QaReplayResult, replayQaTest } from "../../lib/qa-replay";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import type { Pane } from "../../stores/workspace";
import { useWorkspaceStore } from "../../stores/workspace";

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
  const [designMode, setDesignMode] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [capturedElement, setCapturedElement] = useState<CapturedElement | null>(null);
  const [qaRecording, setQaRecording] = useState<QaRecording | null>(null);
  const [replayResult, setReplayResult] = useState<QaReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayStep, setReplayStep] = useState<number>(-1);
  const [savingTest, setSavingTest] = useState(false);
  const [testName, setTestName] = useState("");
  const [qaActionCount, setQaActionCount] = useState(0);
  const designPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayCancelledRef = useRef(false);

  // Cleanup design mode poll on unmount
  useEffect(() => {
    return () => {
      if (designPollRef.current) clearInterval(designPollRef.current);
    };
  }, []);

  // T102: Safe executeJs wrapper — catches CSP blocks and webview errors
  const safeExecJs = useCallback(async (code: string): Promise<unknown> => {
    try {
      return (await window.api.browser?.executeJs(code)) ?? null;
    } catch (err) {
      console.warn("[BrowserPane] executeJs failed:", err);
      return null;
    }
  }, []);

  // T102: Toggle Design Mode — inject/remove selection overlay in webview
  const toggleDesignMode = useCallback(async () => {
    if (designMode) {
      await safeExecJs("window.__exegolDesignDisable?.()");
      setDesignMode(false);
      if (designPollRef.current) {
        clearInterval(designPollRef.current);
        designPollRef.current = null;
      }
    } else {
      if (qaMode) {
        await safeExecJs("window.__exegolQaDisable?.()");
        setQaMode(false);
      }
      await safeExecJs(DESIGN_MODE_INJECTION_SCRIPT);
      setDesignMode(true);
      setCapturedElement(null);
      // Poll for captured element with proper cleanup
      if (designPollRef.current) clearInterval(designPollRef.current);
      designPollRef.current = setInterval(async () => {
        const result = await safeExecJs("window.__exegolDesignCapture");
        if (result) {
          setCapturedElement(result as CapturedElement);
          if (designPollRef.current) {
            clearInterval(designPollRef.current);
            designPollRef.current = null;
          }
        }
      }, 300);
      // Auto-stop after 60s
      setTimeout(() => {
        if (designPollRef.current) {
          clearInterval(designPollRef.current);
          designPollRef.current = null;
        }
      }, 60_000);
    }
  }, [designMode, qaMode, safeExecJs]);

  // T102: Poll QA action count while recording
  useEffect(() => {
    if (!qaMode) {
      setQaActionCount(0);
      return;
    }
    const poll = setInterval(async () => {
      const count = await safeExecJs("window.__exegolQaActions?.length ?? 0");
      if (typeof count === "number") setQaActionCount(count);
    }, 500);
    return () => clearInterval(poll);
  }, [qaMode, safeExecJs]);

  // T102: Toggle QA Mode — inject/remove interaction recorder in webview
  const toggleQaMode = useCallback(async () => {
    if (qaMode) {
      const actions = await safeExecJs("window.__exegolQaActions");
      const errors = await safeExecJs("window.__exegolQaConsoleErrors");
      await safeExecJs("window.__exegolQaDisable?.()");
      setQaMode(false);
      if (Array.isArray(actions) && actions.length > 0) {
        setQaRecording({
          startUrl: currentUrl,
          startedAt: Date.now(),
          actions: actions as QaRecording["actions"],
          consoleErrors: (errors as string[]) ?? [],
        });
      }
    } else {
      if (designMode) {
        await safeExecJs("window.__exegolDesignDisable?.()");
        setDesignMode(false);
      }
      await safeExecJs(QA_MODE_INJECTION_SCRIPT);
      setQaMode(true);
      setQaRecording(null);
    }
  }, [qaMode, designMode, currentUrl, safeExecJs]);

  // T102: Send captured context to focused agent
  const sendToAgent = useCallback((text: string) => {
    const { focusedAgentId } = useAgentStore.getState();
    if (focusedAgentId) {
      window.api.terminal.write(focusedAgentId, `${text}\n`);
    } else {
      navigator.clipboard.writeText(text);
    }
  }, []);

  // T102: Save QA recording as a reusable test
  const handleSaveTest = useCallback(async () => {
    if (!qaRecording || !projectId || !testName.trim()) return;
    setSavingTest(true);
    try {
      await trpcMutate("qaTests.save", {
        projectId,
        name: testName.trim(),
        startUrl: qaRecording.startUrl,
        actions: JSON.stringify(qaRecording.actions),
      });
      setQaRecording(null);
      setTestName("");
    } catch (err) {
      console.error("[BrowserPane] Save test failed:", err);
    } finally {
      setSavingTest(false);
    }
  }, [qaRecording, projectId, testName]);

  // T102: Replay a QA recording against the webview (with cancel + stop-on-fail)
  const handleReplay = useCallback(async () => {
    if (!qaRecording || replaying) return;
    setReplaying(true);
    setReplayResult(null);
    setReplayStep(-1);
    replayCancelledRef.current = false;
    try {
      const executeJs = async (code: string) => {
        if (replayCancelledRef.current) throw new Error("Replay cancelled");
        return await safeExecJs(code);
      };
      const captureScreenshot = async () => {
        try {
          return (await window.api.browser?.captureScreenshot()) ?? null;
        } catch {
          return null;
        }
      };
      const result = await replayQaTest(qaRecording.actions, executeJs, captureScreenshot, {
        onStepStart: (index) => setReplayStep(index),
        onStepComplete: () => {},
      });
      setReplayResult(result);
    } catch (err) {
      console.error("[BrowserPane] Replay failed:", err);
    } finally {
      setReplaying(false);
      setReplayStep(-1);
    }
  }, [qaRecording, replaying, safeExecJs]);

  const cancelReplay = useCallback(() => {
    replayCancelledRef.current = true;
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
      {/* URL bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <button
          type="button"
          onClick={handleBack}
          disabled={!canGoBack}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          title="Back"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={!canGoForward}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          title="Forward"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
          title="Reload"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        {/* T102: Design Mode + QA Mode toggles */}
        <div className="mx-0.5 h-3.5 w-px bg-border" />
        <button
          type="button"
          onClick={toggleDesignMode}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            designMode
              ? "bg-blue-500/20 text-blue-400"
              : "text-text-muted hover:bg-white/10 hover:text-text-primary",
          )}
          title={designMode ? "Exit Design Mode" : "Design Mode — capture UI elements"}
        >
          <Crosshair className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={toggleQaMode}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            qaMode
              ? "bg-red-500/20 text-red-400"
              : "text-text-muted hover:bg-white/10 hover:text-text-primary",
          )}
          title={qaMode ? "Stop Recording — save QA flow" : "QA Mode — record interactions"}
        >
          <Bug className="h-3 w-3" />
        </button>
        {/* Live indicators for active modes */}
        {designMode && <span className="text-[8px] font-medium text-blue-400">DESIGN</span>}
        {qaMode && (
          <span className="text-[8px] font-medium tabular-nums text-red-400">
            REC {qaActionCount > 0 ? `(${qaActionCount})` : ""}
          </span>
        )}
        <div className="mx-0.5 h-3.5 w-px bg-border" />
        <Globe className="h-3 w-3 shrink-0 text-text-muted" />
        {uniquePorts.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {uniquePorts.map((p) => (
              <button
                key={p.port}
                type="button"
                onClick={() => navigateToPort(p.port)}
                className={cn(
                  "flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] transition-colors",
                  currentUrl.includes(`:${p.port}`)
                    ? "bg-accent/20 text-accent"
                    : "text-text-muted hover:bg-white/10 hover:text-text-primary",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    p.source === "runtime" ? "bg-green-500" : "bg-zinc-500",
                  )}
                />
                {p.port}
                {projectId && (
                  <button
                    type="button"
                    className={cn(
                      "ml-0.5 cursor-pointer text-[8px]",
                      preferredPort === p.port ? "text-amber-400" : "text-text-muted/40",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreferred.mutate({ projectId, port: p.port });
                    }}
                    title={preferredPort === p.port ? "Preferred port" : "Set as preferred"}
                  >
                    &#9733;
                  </button>
                )}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={() => setFocusedPane(paneId)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
          }}
          className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          placeholder="http://localhost:3000"
        />
        <button
          type="button"
          onClick={navigate}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Go to URL"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
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
      </div>

      {/* T102: Design Mode capture result */}
      {capturedElement && (
        <div className="shrink-0 border-t border-border bg-blue-500/5 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-blue-300">
              Captured: &lt;{capturedElement.tagName}&gt; {capturedElement.rect.width}x
              {capturedElement.rect.height}px
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => sendToAgent(formatElementForAgent(capturedElement))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-blue-300 hover:bg-blue-500/10"
                title="Send to focused agent"
              >
                <Send className="h-2.5 w-2.5" /> Send to Agent
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(formatElementForAgent(capturedElement));
                  setCapturedElement(null);
                }}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setCapturedElement(null)}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
          <p className="mt-0.5 truncate font-mono text-[9px] text-text-muted">
            {capturedElement.selector}
          </p>
        </div>
      )}

      {/* T102: QA Recording result + save/replay */}
      {qaRecording && (
        <div className="shrink-0 border-t border-border bg-red-500/5 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-red-300">
              Recorded: {qaRecording.actions.length} actions
              {qaRecording.consoleErrors.length > 0 &&
                ` · ${qaRecording.consoleErrors.length} errors`}
              {replaying && ` · Replaying step ${replayStep + 1}/${qaRecording.actions.length}...`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReplay}
                disabled={replaying}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-green-300 hover:bg-green-500/10 disabled:opacity-50"
                title="Replay this recording in the browser"
              >
                {replaying ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Play className="h-2.5 w-2.5" />
                )}
                {replaying ? "Running..." : "Run"}
              </button>
              {replaying && (
                <button
                  type="button"
                  onClick={cancelReplay}
                  className="rounded px-1.5 py-0.5 text-[9px] text-amber-300 hover:bg-amber-500/10"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={() => sendToAgent(formatRecordingForAgent(qaRecording))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-red-300 hover:bg-red-500/10"
                title="Send to focused agent"
              >
                <Send className="h-2.5 w-2.5" /> Agent
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(exportToPlaywright(qaRecording))}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Playwright
              </button>
              <button
                type="button"
                onClick={() => {
                  setQaRecording(null);
                  setReplayResult(null);
                }}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
          {/* Save test row */}
          {projectId && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Test name..."
                className="flex-1 rounded border border-border bg-bg-secondary px-2 py-0.5 text-[10px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTest();
                }}
              />
              <button
                type="button"
                onClick={handleSaveTest}
                disabled={!testName.trim() || savingTest}
                className="flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                <Save className="h-2.5 w-2.5" />
                {savingTest ? "Saving..." : "Save Test"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* T102: Replay result summary */}
      {replayResult && (
        <div
          className={cn(
            "shrink-0 border-t border-border px-3 py-2",
            replayResult.passed ? "bg-green-500/5" : "bg-red-500/5",
          )}
        >
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] font-medium",
                replayResult.passed ? "text-green-300" : "text-red-300",
              )}
            >
              {replayResult.passed ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {replayResult.passed
                ? "All steps passed"
                : `${replayResult.stepResults.filter((s) => !s.passed).length} step(s) failed`}
              <span className="text-text-muted">· {replayResult.totalDurationMs}ms</span>
            </span>
            <button
              type="button"
              onClick={() => setReplayResult(null)}
              className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
            >
              Dismiss
            </button>
          </div>
          {replayResult.stepResults.some((s) => !s.passed) && (
            <div className="mt-1 space-y-0.5">
              {replayResult.stepResults
                .filter((s) => !s.passed)
                .map((s) => (
                  <p key={s.actionIndex} className="truncate text-[9px] text-red-400">
                    Step {s.actionIndex + 1}: {s.error}
                  </p>
                ))}
            </div>
          )}
          {replayResult.consoleErrors.length > 0 && (
            <p className="mt-1 text-[9px] text-amber-400">
              {replayResult.consoleErrors.length} console error(s) during replay
            </p>
          )}
        </div>
      )}
    </div>
  );
}
