import type { Agent } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bug, Crosshair, RotateCw } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { BrowserQaRecordingBar } from "./components/workspace/BrowserQaRecordingBar";
import { BrowserReplayResultBar } from "./components/workspace/BrowserReplayResultBar";
import { DesignIssueBubble } from "./components/workspace/DesignIssueBubble";
import { useDesignQaModes } from "./components/workspace/use-design-qa-modes";
import { useQaReplay } from "./components/workspace/use-qa-replay";
import { useWebviewControls, useWebviewNavState } from "./components/workspace/use-webview";
import { isPasteTarget } from "./lib/agent-input";
import { trpcInvoke } from "./lib/trpc-client";

/** Live agents of the project, the targets for design and QA reports. This window has no agent store */
function useRunningAgentsQuery(projectId: string | undefined) {
  const { data: projectAgents } = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => trpcInvoke<Agent[]>("agents.list", { projectId }),
    enabled: !!projectId,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
  return useMemo(() => (projectAgents ?? []).filter(isPasteTarget), [projectAgents]);
}

export function FloatingBrowser({ url, projectId }: { url: string; projectId?: string }) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const {
    pageUrl: currentUrl,
    loading,
    canGoBack,
    canGoForward,
  } = useWebviewNavState(webviewRef, url);
  const { handleBack, handleForward, handleReload } = useWebviewControls(webviewRef);
  const [issueMessage, setIssueMessage] = useState("");
  const runningAgents = useRunningAgentsQuery(projectId);

  const safeExecJs = useCallback(async (code: string): Promise<unknown> => {
    try {
      return (await window.api.browser?.executeJs(code)) ?? null;
    } catch {
      return null;
    }
  }, []);

  const modes = useDesignQaModes({ safeExecJs, currentUrl });
  // Not persisted, no screenshots: this window has no saved test to attach a run to
  const replay = useQaReplay(safeExecJs);
  const handleReplay = () => {
    if (!modes.qaRecording) return;
    replay.runReplay(modes.qaRecording.actions, {
      stopOnFail: true,
      captureScreenshot: async () => null,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <FloatingToolbar
        currentUrl={currentUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        designMode={modes.designMode}
        qaMode={modes.qaMode}
        qaActionCount={modes.qaActionCount}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onToggleDesignMode={modes.toggleDesignMode}
        onToggleQaMode={modes.toggleQaMode}
      />

      {/* Webview + floating bubble */}
      <div className="relative flex-1 overflow-hidden bg-white">
        <webview
          // biome-ignore lint/suspicious/noExplicitAny: Electron webview not in TS DOM
          ref={webviewRef as React.Ref<any>}
          src={url}
          className="h-full w-full"
          {...({ allowpopups: "true" } as Record<string, string>)}
        />

        {modes.capturedElement && (
          <DesignIssueBubble
            element={modes.capturedElement}
            message={issueMessage}
            onMessageChange={setIssueMessage}
            agents={runningAgents}
            onClear={() => {
              modes.setCapturedElement(null);
              setIssueMessage("");
            }}
          />
        )}
      </div>

      {modes.qaRecording && (
        <BrowserQaRecordingBar
          qaRecording={modes.qaRecording}
          replaying={replay.replaying}
          replayStep={replay.replayStep}
          projectId={null}
          runningAgents={runningAgents}
          onReplay={handleReplay}
          onCancelReplay={replay.cancelReplay}
          onDismiss={() => modes.setQaRecording(null)}
        />
      )}

      {replay.replayResult && (
        <BrowserReplayResultBar
          replayResult={replay.replayResult}
          onDismiss={() => replay.setReplayResult(null)}
        />
      )}
    </div>
  );
}

function FloatingToolbar({
  currentUrl,
  loading,
  canGoBack,
  canGoForward,
  designMode,
  qaMode,
  qaActionCount,
  onBack,
  onForward,
  onReload,
  onToggleDesignMode,
  onToggleQaMode,
}: {
  currentUrl: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  designMode: boolean;
  qaMode: boolean;
  qaActionCount: number;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleDesignMode: () => void;
  onToggleQaMode: () => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-1.5">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
        title="Back"
      >
        <ArrowLeft className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onForward}
        disabled={!canGoForward}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
        title="Forward"
      >
        <ArrowRight className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onReload}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
        title="Reload"
      >
        <RotateCw className="h-3 w-3" />
      </button>
      <div className="mx-0.5 h-3.5 w-px bg-border" />
      {/* Design mode */}
      <button
        type="button"
        onClick={onToggleDesignMode}
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
        onClick={onToggleQaMode}
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
  );
}
