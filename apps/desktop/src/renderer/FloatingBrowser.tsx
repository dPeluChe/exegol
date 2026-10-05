import type { Agent } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Columns3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilterChip } from "./components/common/FilterChip";
import { BrowserAddressBar } from "./components/workspace/BrowserAddressBar";
import { BrowserQaRecordingBar } from "./components/workspace/BrowserQaRecordingBar";
import { BrowserReplayResultBar } from "./components/workspace/BrowserReplayResultBar";
import { DeviceFrame, PageView, useAllSizes } from "./components/workspace/BrowserViewport";
import { DesignIssueBubble } from "./components/workspace/DesignIssueBubble";
import { webviewIdOf } from "./components/workspace/use-browser-qa";
import { useDesignQaModes } from "./components/workspace/use-design-qa-modes";
import { useQaReplay } from "./components/workspace/use-qa-replay";
import { useWebviewControls, useWebviewNavState } from "./components/workspace/use-webview";
import type { PortInfo } from "./hooks/use-trpc-scheduler";
import { focusAddressBar } from "./lib/address-bar";
import { isPasteTarget } from "./lib/agent-input";
import {
  compareSizes,
  type PageSize,
  parseSize,
  sizeKey,
  toHttpUrl,
} from "./lib/browser-viewports";
import { trpcInvoke } from "./lib/trpc-client";

/** Live agents of the project, the targets for design and QA reports. This window has no agent store */
function useRunningAgentsQuery(projectId: string | undefined) {
  const { data: projectAgents } = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => trpcInvoke<Agent[]>("agents.list", { projectId }),
    enabled: !!projectId,
    refetchInterval: 30_000,
    staleTime: 15_000,
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
  // Cmd+R reloads the (leading) page, not this window
  useEffect(
    () =>
      window.api.onMenuAction((action) => {
        if (action === "reload") handleReload();
        else if (action === "focus-location") focusAddressBar();
      }),
    [handleReload],
  );
  const [issueMessage, setIssueMessage] = useState("");
  // What is being typed in the address bar; null shows the page's URL
  const [draft, setDraft] = useState<string | null>(null);
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
      {/* The pane's own bar: the same controls, plus Sizes; no dev-server ports here */}
      <BrowserAddressBar
        urlInput={draft ?? currentUrl}
        currentUrl={currentUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        designMode={modes.designMode}
        qaMode={modes.qaMode}
        qaActionCount={modes.qaActionCount}
        uniquePorts={NO_PORTS}
        projectId={null}
        preferredPort={null}
        setUrlInputValue={setDraft}
        onFocus={() => {}}
        onNavigate={() => {
          const target = toHttpUrl(draft ?? currentUrl);
          setDraft(null);
          if (target) loadIn(webviewRef, target);
        }}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onOpenDevTools={() => window.api.floating.selfToggleDevTools()}
        onToggleDesignMode={modes.toggleDesignMode}
        onToggleQaMode={modes.toggleQaMode}
        onNavigateToPort={() => {}}
        onSetPreferredPort={() => {}}
        viewport={size}
        onViewport={compare ? undefined : setSize}
        extra={
          <button
            type="button"
            onClick={() => setCompare((c) => (c ? null : compareSizes(size)))}
            className={cn(
              "flex h-5 items-center gap-1 rounded px-1 text-[10px] transition-colors",
              compare ? "bg-accent/20 text-accent" : "text-text-muted hover:bg-white/10",
            )}
            title={compare ? "Back to one page" : "See the page at several sizes side by side"}
          >
            <Columns3 className="h-3 w-3" />
            Sizes
          </button>
        }
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

const NO_PORTS: PortInfo[] = [];

/** Go somewhere in a webview that is already showing a page (its src stays as it was) */
function loadIn(ref: React.RefObject<HTMLElement | null>, url: string) {
  try {
    (ref.current as unknown as { loadURL?: (u: string) => void } | null)?.loadURL?.(url);
  } catch {
    /* not attached yet */
  }
}
