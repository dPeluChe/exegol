import { cn } from "@exegol/ui";
import { ArrowLeft, ArrowRight, Bug, Crosshair, Globe, RefreshCw, RotateCw } from "lucide-react";
import type { PortInfo } from "../../hooks/use-trpc-scheduler";

interface BrowserAddressBarProps {
  urlInput: string;
  currentUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  designMode: boolean;
  qaMode: boolean;
  qaActionCount: number;
  uniquePorts: PortInfo[];
  projectId: string | null;
  preferredPort: number | null | undefined;
  setUrlInputValue: (v: string) => void;
  onFocus: () => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleDesignMode: () => void;
  onToggleQaMode: () => void;
  onNavigateToPort: (port: number) => void;
  onSetPreferredPort: (port: number) => void;
}

export function BrowserAddressBar({
  urlInput,
  currentUrl,
  canGoBack,
  canGoForward,
  designMode,
  qaMode,
  qaActionCount,
  uniquePorts,
  projectId,
  preferredPort,
  setUrlInputValue,
  onFocus,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onToggleDesignMode,
  onToggleQaMode,
  onNavigateToPort,
  onSetPreferredPort,
}: BrowserAddressBarProps) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
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
      {/* T102: Design Mode + QA Mode toggles */}
      <div className="mx-0.5 h-3.5 w-px bg-border" />
      <button
        type="button"
        onClick={onToggleDesignMode}
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
        onClick={onToggleQaMode}
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
            <div key={p.port} className="flex items-center">
              <button
                type="button"
                onClick={() => onNavigateToPort(p.port)}
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
              </button>
              {projectId && (
                <button
                  type="button"
                  className={cn(
                    "cursor-pointer text-[8px]",
                    preferredPort === p.port ? "text-amber-400" : "text-text-muted/40",
                  )}
                  onClick={() => onSetPreferredPort(p.port)}
                  title={preferredPort === p.port ? "Preferred port" : "Set as preferred"}
                >
                  &#9733;
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        value={urlInput}
        onChange={(e) => setUrlInputValue(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter") onNavigate();
        }}
        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        placeholder="http://localhost:3000"
      />
      <button
        type="button"
        onClick={onNavigate}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Go to URL"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  );
}
