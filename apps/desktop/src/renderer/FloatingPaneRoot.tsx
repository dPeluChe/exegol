import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "./components/common";
import { useTheme } from "./hooks/use-theme";

// Lazy — only the terminal case needs xterm.js, no reason to pull it for browser floats
const TerminalInstance = lazy(() =>
  import("./components/terminal/TerminalInstance").then((m) => ({ default: m.TerminalInstance })),
);

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
        {params.type === "browser" && params.url && <FloatingBrowser url={params.url} />}
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
      <div className="flex-1 text-[10px] font-medium text-text-secondary truncate">{title}</div>
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {type === "browser" && (
          <button
            type="button"
            onClick={toggleDevTools}
            className="flex h-5 px-1.5 items-center justify-center rounded text-[9px] text-text-muted hover:bg-white/10 hover:text-text-primary"
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

function FloatingBrowser({ url }: { url: string }) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

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
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-1.5">
        <button
          type="button"
          onClick={handleBack}
          disabled={!canGoBack}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          title="Back"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={!canGoForward}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          title="Forward"
        >
          ›
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
          title="Reload"
        >
          ↻
        </button>
        {loading && <div className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
        <div className="flex-1 truncate px-1 text-[9px] text-text-muted">{currentUrl}</div>
      </div>
      <div className="flex-1 overflow-hidden bg-white">
        <webview
          // biome-ignore lint/suspicious/noExplicitAny: Electron webview not in TS DOM
          ref={webviewRef as React.Ref<any>}
          src={url}
          className="h-full w-full"
          {...({ allowpopups: "true" } as Record<string, string>)}
        />
      </div>
    </div>
  );
}
