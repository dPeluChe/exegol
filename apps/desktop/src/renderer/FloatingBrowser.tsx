import type { Agent } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bug, Columns3, Crosshair, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilterChip } from "./components/common/FilterChip";
import { BrowserQaRecordingBar } from "./components/workspace/BrowserQaRecordingBar";
import { BrowserReplayResultBar } from "./components/workspace/BrowserReplayResultBar";
import {
  DeviceFrame,
  PageView,
  useAllSizes,
  ViewportSelect,
} from "./components/workspace/BrowserViewport";
import { DesignIssueBubble } from "./components/workspace/DesignIssueBubble";
import { webviewIdOf } from "./components/workspace/use-browser-qa";
import { useDesignQaModes } from "./components/workspace/use-design-qa-modes";
import { useQaReplay } from "./components/workspace/use-qa-replay";
import { useWebviewControls, useWebviewNavState } from "./components/workspace/use-webview";
import { isPasteTarget } from "./lib/agent-input";
import { compareSizes, type PageSize, parseSize, sizeKey } from "./lib/browser-viewports";
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

export function FloatingBrowser({
  url,
  projectId,
  initialSizeKey,
}: {
  url: string;
  projectId?: string;
  /** "WxH" of the pane's size: matched to the named size (a preset or yours) when there is one */
  initialSizeKey?: string;
}) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const {
    pageUrl: currentUrl,
    documentUrl,
    loading,
    canGoBack,
    canGoForward,
    // Its pane docks back on this page, not the one it floated from
  } = useWebviewNavState(webviewRef, url, window.api.floating.reportPage);
  const allSizes = useAllSizes();
  const [size, setSize] = useState(() =>
    initialSizeKey
      ? (allSizes.find((s) => sizeKey(s) === initialSizeKey) ??
        parseSize(initialSizeKey) ??
        undefined)
      : undefined,
  );
  // Several sizes side by side: the first leads (toolbar, design, QA), the others follow its page
  const [compare, setCompare] = useState<PageSize[] | null>(null);
  const { handleBack, handleForward, handleReload } = useWebviewControls(webviewRef);
  const [issueMessage, setIssueMessage] = useState("");
  const runningAgents = useRunningAgentsQuery(projectId);

  // The leading webview by id: with several sizes open, "the window's webview" is ambiguous
  const safeExecJs = useCallback(async (code: string): Promise<unknown> => {
    try {
      return (await window.api.browser?.executeJs(code, webviewIdOf(webviewRef))) ?? null;
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
        size={size}
        onSize={setSize}
        comparing={!!compare}
        onCompare={() => setCompare((c) => (c ? null : compareSizes(size)))}
      />
      {compare && <SizeChips selected={compare} onChange={setCompare} />}

      {/* Webview + floating bubble */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {/* One tree with or without Sizes: the leading webview keeps its key and never remounts */}
        <div
          className={cn(
            "h-full",
            compare && "flex items-start gap-3 overflow-auto bg-bg-tertiary p-3",
          )}
        >
          {(compare ?? [size]).map((s, i) => (
            <DeviceFrame
              key={i === 0 ? "leader" : sizeKey(s as PageSize)}
              size={s}
              inline={!!compare}
              caption={
                compare && s
                  ? `${s.label} ${s.width}×${s.height}${i === 0 ? " · leads" : ""}`
                  : undefined
              }
            >
              {i === 0 ? (
                <PageView ref={webviewRef} src={url} />
              ) : (
                <FollowerView url={documentUrl} />
              )}
            </DeviceFrame>
          ))}
        </div>

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
  size,
  onSize,
  comparing,
  onCompare,
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
  size: PageSize | undefined;
  onSize: (size: PageSize | undefined) => void;
  comparing: boolean;
  onCompare: () => void;
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
      {!comparing && <ViewportSelect value={size} onChange={onSize} />}
      <button
        type="button"
        onClick={onCompare}
        className={`flex h-5 items-center gap-1 rounded px-1 text-[10px] transition-colors ${
          comparing ? "bg-accent/20 text-accent" : "text-text-muted hover:bg-white/10"
        }`}
        title={comparing ? "Back to one page" : "See the page at several sizes side by side"}
      >
        <Columns3 className="h-3 w-3" />
        Sizes
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

/** Which sizes the comparison shows: at least one, at most four (each is a whole page renderer) */
const MAX_COMPARE = 4;

function SizeChips({
  selected,
  onChange,
}: {
  selected: PageSize[];
  onChange: (sizes: PageSize[]) => void;
}) {
  const all = useAllSizes();
  const on = new Set(selected.map(sizeKey));
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-1.5 py-1">
      {all.map((s) => {
        const key = sizeKey(s);
        const active = on.has(key);
        return (
          <FilterChip
            key={key}
            active={active}
            disabled={active ? selected.length === 1 : selected.length >= MAX_COMPARE}
            onClick={() =>
              onChange(active ? selected.filter((x) => sizeKey(x) !== key) : [...selected, s])
            }
          >
            {s.label} {s.width}
          </FilterChip>
        );
      })}
    </div>
  );
}

/** Another size of the same page: it loads the leader's page on full navigations only (following
 *  every in-page route would reload it each time) */
function FollowerView({ url }: { url: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [src] = useState(url);
  useEffect(() => {
    const wv = ref.current as unknown as {
      getURL?: () => string;
      loadURL?: (u: string) => void;
    } | null;
    try {
      if (wv?.getURL && wv.getURL() !== url) wv.loadURL?.(url);
    } catch {
      /* not attached yet: its src covers the first load */
    }
  }, [url]);
  return <PageView ref={ref} src={src} />;
}
