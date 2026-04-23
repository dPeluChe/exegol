import { cn } from "@exegol/ui";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Crosshair,
  Globe,
  RefreshCw,
  RotateCw,
  Send,
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

  // T102: Toggle Design Mode — inject/remove selection overlay in webview
  const toggleDesignMode = useCallback(async () => {
    if (designMode) {
      await window.api.browser?.executeJs("window.__exegolDesignDisable?.()");
      setDesignMode(false);
    } else {
      if (qaMode) {
        await window.api.browser?.executeJs("window.__exegolQaDisable?.()");
        setQaMode(false);
      }
      await window.api.browser?.executeJs(DESIGN_MODE_INJECTION_SCRIPT);
      setDesignMode(true);
      setCapturedElement(null);
      // Poll for captured element
      const poll = setInterval(async () => {
        const result = await window.api.browser?.executeJs("window.__exegolDesignCapture");
        if (result) {
          setCapturedElement(result as CapturedElement);
          clearInterval(poll);
        }
      }, 300);
      // Stop polling after 60s
      setTimeout(() => clearInterval(poll), 60_000);
    }
  }, [designMode, qaMode]);

  // T102: Toggle QA Mode — inject/remove interaction recorder in webview
  const toggleQaMode = useCallback(async () => {
    if (qaMode) {
      const actions = await window.api.browser?.executeJs("window.__exegolQaActions");
      const errors = await window.api.browser?.executeJs("window.__exegolQaConsoleErrors");
      await window.api.browser?.executeJs("window.__exegolQaDisable?.()");
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
        await window.api.browser?.executeJs("window.__exegolDesignDisable?.()");
        setDesignMode(false);
      }
      await window.api.browser?.executeJs(QA_MODE_INJECTION_SCRIPT);
      setQaMode(true);
      setQaRecording(null);
    }
  }, [qaMode, designMode, currentUrl]);

  // T102: Send captured context to focused agent
  const sendToAgent = useCallback((text: string) => {
    const { focusedAgentId } = useAgentStore.getState();
    if (focusedAgentId) {
      window.api.terminal.write(focusedAgentId, `${text}\n`);
    } else {
      navigator.clipboard.writeText(text);
    }
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

      {/* T102: QA Recording result */}
      {qaRecording && (
        <div className="shrink-0 border-t border-border bg-red-500/5 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-red-300">
              Recorded: {qaRecording.actions.length} actions
              {qaRecording.consoleErrors.length > 0 &&
                ` · ${qaRecording.consoleErrors.length} errors`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => sendToAgent(formatRecordingForAgent(qaRecording))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-red-300 hover:bg-red-500/10"
                title="Send to focused agent"
              >
                <Send className="h-2.5 w-2.5" /> Send to Agent
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(exportToPlaywright(qaRecording));
                  setQaRecording(null);
                }}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Copy Playwright
              </button>
              <button
                type="button"
                onClick={() => setQaRecording(null)}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
