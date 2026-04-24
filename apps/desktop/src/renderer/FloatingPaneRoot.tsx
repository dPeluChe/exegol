import type { Agent } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bug, Crosshair, Loader2, Play, RotateCw, Send } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingSpinner } from "./components/common";
import { useTheme } from "./hooks/use-theme";
import {
  buildDesignIssue,
  type CapturedElement,
  DESIGN_MODE_INJECTION_SCRIPT,
} from "./lib/design-capture";
import {
  exportToPlaywright,
  formatRecordingForAgent,
  QA_MODE_INJECTION_SCRIPT,
  type QaRecording,
} from "./lib/qa-recorder";
import { replayQaTest } from "./lib/qa-replay";
import { trpcInvoke } from "./lib/trpc-client";

// Lazy — only the terminal case needs xterm.js, no reason to pull it for browser floats
const TerminalInstance = lazy(() =>
  import("./components/terminal/TerminalInstance").then((m) => ({ default: m.TerminalInstance })),
);

// ─── Constants ───────────────────────────────────────────────────────────────

const DESIGN_POLL_MS = 300;
const DESIGN_AUTO_STOP_MS = 60_000;
const RUNNING = new Set(["running", "waiting_input"]);

/**
 * Parameters passed to the floating window via query string.
 * See `apps/desktop/src/main/windows/floating.ts#buildUrl`.
 */
interface FloatingParams {
  paneId: string;
  type: "terminal" | "browser";
  title: string;
  agentId?: string;
  url?: string;
  projectId?: string;
}

function parseParams(): FloatingParams | null {
  const p = new URLSearchParams(window.location.search);
  const paneId = p.get("floatingPane");
  const type = p.get("floatingType") as "terminal" | "browser" | null;
  if (!paneId || !type) return null;
  return {
    paneId,
    type,
    title: p.get("floatingTitle") ?? "Floating",
    agentId: p.get("floatingAgentId") ?? undefined,
    url: p.get("floatingUrl") ?? undefined,
    projectId: p.get("floatingProjectId") ?? undefined,
  };
}

/** Top-level component for a floating pane window (minimal chrome + content). */
export function FloatingPaneRoot() {
  useTheme();
  const params = parseParams();

  if (!params) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-primary">
        <p className="text-xs text-text-muted">Missing floating pane parameters</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-bg-primary">
      <FloatingTitleBar title={params.title} type={params.type} />
      <div className="flex-1 overflow-hidden">
        {params.type === "terminal" && params.agentId && (
          <Suspense fallback={<LoadingSpinner label="Loading terminal..." className="h-full" />}>
            <TerminalInstance agentId={params.agentId} />
          </Suspense>
        )}
        {params.type === "browser" && params.url && (
          <FloatingBrowser url={params.url} projectId={params.projectId} />
        )}
      </div>
    </div>
  );
}

function FloatingTitleBar({ title, type }: { title: string; type: "terminal" | "browser" }) {
  const close = () => window.api.floating.selfClose();
  const toggleDevTools = () => window.api.floating.selfToggleDevTools();
  return (
    <div
      className="flex h-7 shrink-0 items-center border-b border-border bg-bg-secondary pl-[72px] pr-1"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex-1 truncate text-[10px] font-medium text-text-secondary">{title}</div>
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {type === "browser" && (
          <button
            type="button"
            onClick={toggleDevTools}
            className="flex h-5 items-center justify-center rounded px-1.5 text-[9px] text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Toggle DevTools"
          >
            Inspect
          </button>
        )}
        <button
          type="button"
          onClick={close}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-red-400/80 hover:text-white"
          title="Close floating pane"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── FloatIssueBubble ────────────────────────────────────────────────────────

interface FloatIssueBubbleProps {
  element: CapturedElement;
  message: string;
  onMessageChange: (v: string) => void;
  agents: Agent[];
  onSend: (agentId: string) => void;
  onCopy: () => void;
  onDismiss: () => void;
}

function FloatIssueBubble({
  element,
  message,
  onMessageChange,
  agents,
  onSend,
  onCopy,
  onDismiss,
}: FloatIssueBubbleProps) {
  const { rect } = element;
  const cx = rect.x + rect.width / 2;
  const above = rect.y > 180;

  return (
    <div
      className="absolute z-30 w-72 overflow-hidden rounded-xl border border-blue-500/30 bg-bg-secondary/95 shadow-2xl backdrop-blur-sm"
      style={{
        left: `clamp(8px, ${Math.round(cx - 144)}px, calc(100% - 296px))`,
        ...(above
          ? { bottom: `calc(100% - ${rect.y - 10}px)` }
          : { top: `${rect.y + rect.height + 10}px` }),
      }}
    >
      {/* Arrow */}
      <div
        className="absolute left-1/2 h-2.5 w-2.5 border-blue-500/30 bg-bg-secondary/95"
        style={
          above
            ? {
                bottom: -6,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                transform: "translateX(-50%) rotate(45deg)",
              }
            : {
                top: -6,
                borderLeftWidth: 1,
                borderTopWidth: 1,
                transform: "translateX(-50%) rotate(45deg)",
              }
        }
      />
      <div className="p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-blue-300">
            &lt;{element.tagName}&gt; {rect.width}×{rect.height}px
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] leading-none text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        </div>
        <p className="mb-2 truncate font-mono text-[9px] text-text-muted">{element.selector}</p>
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Describe what needs to change (optional)..."
          className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-primary placeholder:text-text-muted/50 focus:border-blue-500/50 focus:outline-none"
          rows={2}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSend(a.id)}
              className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-[9px] text-blue-300 hover:bg-blue-500/20"
            >
              <Send className="h-2.5 w-2.5" /> {a.cliType}
            </button>
          ))}
          <button
            type="button"
            onClick={onCopy}
            className="rounded px-2 py-1 text-[9px] text-text-muted hover:bg-white/5"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FloatingBrowser ─────────────────────────────────────────────────────────

function FloatingBrowser({ url, projectId }: { url: string; projectId?: string }) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // QA / Design mode state
  const [designMode, setDesignMode] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [capturedElement, setCapturedElement] = useState<CapturedElement | null>(null);
  const [issueMessage, setIssueMessage] = useState("");
  const [qaRecording, setQaRecording] = useState<QaRecording | null>(null);
  const [qaActionCount, setQaActionCount] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [replayStep, setReplayStep] = useState(-1);
  const designPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayCancelRef = useRef(false);

  // Running agents for the project (used for send-to-agent)
  const { data: projectAgents } = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => trpcInvoke<Agent[]>("agents.list", { projectId }),
    enabled: !!projectId,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
  const runningAgents = useMemo(
    () => (projectAgents ?? []).filter((a) => RUNNING.has(a.status)),
    [projectAgents],
  );

  const safeExecJs = useCallback(async (code: string): Promise<unknown> => {
    try {
      return (await window.api.browser?.executeJs(code)) ?? null;
    } catch {
      return null;
    }
  }, []);

  // QA action count polling
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (designPollRef.current) clearInterval(designPollRef.current);
    };
  }, []);

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
      if (designPollRef.current) clearInterval(designPollRef.current);
      designPollRef.current = setInterval(async () => {
        const result = await safeExecJs("window.__exegolDesignCapture");
        if (result) {
          if (designPollRef.current) {
            clearInterval(designPollRef.current);
            designPollRef.current = null;
          }
          await safeExecJs("window.__exegolDesignDisable?.()");
          setDesignMode(false);
          setCapturedElement(result as CapturedElement);
        }
      }, DESIGN_POLL_MS);
      setTimeout(() => {
        if (designPollRef.current) {
          clearInterval(designPollRef.current);
          designPollRef.current = null;
        }
      }, DESIGN_AUTO_STOP_MS);
    }
  }, [designMode, qaMode, safeExecJs]);

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

  const handleReplay = useCallback(async () => {
    if (!qaRecording || replaying) return;
    setReplaying(true);
    replayCancelRef.current = false;
    try {
      await replayQaTest(
        qaRecording.actions,
        async (code) => {
          if (replayCancelRef.current) throw new Error("Replay cancelled");
          return safeExecJs(code);
        },
        async () => null,
        { onStepStart: (i) => setReplayStep(i), onStepComplete: () => {} },
        { stopOnFail: true },
      );
    } catch {
      /* cancelled or error */
    } finally {
      setReplaying(false);
      setReplayStep(-1);
    }
  }, [qaRecording, replaying, safeExecJs]);

  const sendToAgent = useCallback((agentId: string, text: string) => {
    window.api.terminal.write(agentId, `${text}\n`);
  }, []);

  // Webview navigation events
  useEffect(() => {
    const webview = webviewRef.current as unknown as {
      addEventListener: (e: string, fn: (ev: Event) => void) => void;
      removeEventListener: (e: string, fn: (ev: Event) => void) => void;
      canGoBack: () => boolean;
      canGoForward: () => boolean;
    } | null;
    if (!webview) return;
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        /* not ready */
      }
    };
    const onNav = (e: Event) => {
      const u = (e as unknown as { url?: string }).url;
      if (u) setCurrentUrl(u);
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        /* not ready */
      }
    };
    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("did-stop-loading", onStop);
    webview.addEventListener("did-navigate", onNav);
    webview.addEventListener("did-navigate-in-page", onNav);
    return () => {
      webview.removeEventListener("did-start-loading", onStart);
      webview.removeEventListener("did-stop-loading", onStop);
      webview.removeEventListener("did-navigate", onNav);
      webview.removeEventListener("did-navigate-in-page", onNav);
    };
  }, []);

  const handleBack = () => {
    const wv = webviewRef.current as unknown as { goBack?: () => void } | null;
    wv?.goBack?.();
  };
  const handleForward = () => {
    const wv = webviewRef.current as unknown as { goForward?: () => void } | null;
    wv?.goForward?.();
  };
  const handleReload = () => {
    const wv = webviewRef.current as unknown as { reload?: () => void } | null;
    wv?.reload?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-1.5">
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
        <div className="mx-0.5 h-3.5 w-px bg-border" />
        {/* Design mode */}
        <button
          type="button"
          onClick={toggleDesignMode}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
            designMode
              ? "bg-blue-500/20 text-blue-400"
              : "text-text-muted hover:bg-white/10 hover:text-text-primary"
          }`}
          title={designMode ? "Exit Design Mode" : "Design Mode — capture UI elements"}
        >
          <Crosshair className="h-3 w-3" />
        </button>
        {/* QA mode */}
        <button
          type="button"
          onClick={toggleQaMode}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
            qaMode
              ? "bg-red-500/20 text-red-400"
              : "text-text-muted hover:bg-white/10 hover:text-text-primary"
          }`}
          title={qaMode ? "Stop Recording" : "QA Mode — record interactions"}
        >
          <Bug className="h-3 w-3" />
        </button>
        {designMode && <span className="text-[8px] font-medium text-blue-400">DESIGN</span>}
        {qaMode && (
          <span className="text-[8px] font-medium tabular-nums text-red-400">
            REC {qaActionCount > 0 ? `(${qaActionCount})` : ""}
          </span>
        )}
        <div className="mx-0.5 h-3.5 w-px bg-border" />
        {loading && <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
        <div className="flex-1 truncate px-1 text-[9px] text-text-muted">{currentUrl}</div>
      </div>

      {/* Webview + floating bubble */}
      <div className="relative flex-1 overflow-hidden bg-white">
        <webview
          // biome-ignore lint/suspicious/noExplicitAny: Electron webview not in TS DOM
          ref={webviewRef as React.Ref<any>}
          src={url}
          className="h-full w-full"
          {...({ allowpopups: "true" } as Record<string, string>)}
        />

        {/* Design capture — floating issue reporter bubble */}
        {capturedElement && (
          <FloatIssueBubble
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

      {/* QA recording result */}
      {qaRecording && (
        <div className="shrink-0 border-t border-border bg-red-500/5 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-red-300">
              Recorded: {qaRecording.actions.length} actions
              {replaying && ` · step ${replayStep + 1}/${qaRecording.actions.length}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReplay}
                disabled={replaying}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-green-300 hover:bg-green-500/10 disabled:opacity-50"
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
                  onClick={() => {
                    replayCancelRef.current = true;
                  }}
                  className="rounded px-1.5 py-0.5 text-[9px] text-amber-300 hover:bg-amber-500/10"
                >
                  Cancel
                </button>
              )}
              {runningAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => sendToAgent(a.id, formatRecordingForAgent(qaRecording))}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-red-300 hover:bg-red-500/10"
                >
                  <Send className="h-2.5 w-2.5" /> {a.cliType}
                </button>
              ))}
              {runningAgents.length === 0 && (
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(formatRecordingForAgent(qaRecording))
                  }
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
                >
                  <Send className="h-2.5 w-2.5" /> Copy
                </button>
              )}
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(exportToPlaywright(qaRecording))}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                Playwright
              </button>
              <button
                type="button"
                onClick={() => setQaRecording(null)}
                className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
