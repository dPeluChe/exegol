import { lazy, Suspense } from "react";
import { LoadingSpinner } from "./components/common";
import { FloatingBrowser } from "./FloatingBrowser";
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
