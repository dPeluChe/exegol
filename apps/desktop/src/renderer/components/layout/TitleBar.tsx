import { cn } from "@exegol/ui";
import { Minus, Square, X } from "lucide-react";
import { useProject } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { AttentionQueue } from "./AttentionQueue";

export function TitleBar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(activeProjectId);
  const platform = window.api?.app?.getPlatform?.() ?? "darwin";
  const isMac = platform === "darwin";

  return (
    <div
      className={cn(
        "titlebar-drag flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-3",
        isMac && "pl-20",
      )}
    >
      {/* Left: spacer for macOS traffic lights, attention queue (T141) */}
      <div className="flex items-center gap-2">
        <AttentionQueue />
      </div>

      {/* Center: Active project */}
      <div className="absolute left-1/2 -translate-x-1/2">
        {project ? (
          <span className="text-xs text-text-secondary">{project.name}</span>
        ) : (
          <span className="text-xs text-text-muted">No project selected</span>
        )}
      </div>

      {/* Right: Window controls (non-macOS only) */}
      {!isMac && (
        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.api.windowControls.minimize()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
          >
            <Minus className="h-3.5 w-3.5 text-text-secondary" />
          </button>
          <button
            type="button"
            onClick={() => window.api.windowControls.maximize()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
          >
            <Square className="h-3 w-3 text-text-secondary" />
          </button>
          <button
            type="button"
            onClick={() => window.api.windowControls.close()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-500/80"
          >
            <X className="h-3.5 w-3.5 text-text-secondary" />
          </button>
        </div>
      )}
    </div>
  );
}
