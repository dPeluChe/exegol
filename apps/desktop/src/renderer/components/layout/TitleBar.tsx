import { Code, Minus, Square, X } from "lucide-react";
import { useProject } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ProjectAvatar } from "../common/ProjectAvatar";
import { AttentionQueue } from "./AttentionQueue";
import { BugReportButton } from "./BugReportDialog";
import { useWidgetLayout, WidgetZone } from "./bar-widgets";
import { UpdateButton } from "./UpdateButton";

/** Fixed: traffic-light room, the title bar buttons, the project name, window controls. The
 *  widget zones (Settings > Bars) sit after the buttons and before the controls; the center is
 *  the name only. Side columns never shrink below the fixed items, the name truncates first */
export function TitleBar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(activeProjectId);
  const layout = useWidgetLayout();
  const platform = window.api?.app?.getPlatform?.() ?? "darwin";
  const isMac = platform === "darwin";

  return (
    <div className="titlebar-drag grid h-10 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3 border-b border-border bg-bg-secondary px-3 text-[11px] text-text-muted">
      <div className="flex items-center gap-3">
        {/* pl-20 of the bar before the zones: the traffic lights' room */}
        {isMac && <div className="w-[68px] shrink-0" />}
        <div className="titlebar-no-drag flex shrink-0 items-center gap-2">
          <AttentionQueue />
          <button
            type="button"
            onClick={() => window.api.toggleDevTools?.()}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
            title={isMac ? "Toggle app DevTools (⌥⌘I)" : "Toggle app DevTools"}
          >
            <Code className="h-3.5 w-3.5" />
          </button>
          <BugReportButton />
          <UpdateButton />
        </div>
        <WidgetZone layout={layout} bar="header" slot="left" />
      </div>

      <div className="flex min-w-0 max-w-[40vw] items-center justify-center overflow-hidden">
        {project ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
            <ProjectAvatar project={project} />
            <span className="truncate">{project.name}</span>
          </span>
        ) : (
          <span className="truncate text-xs text-text-muted">No project selected</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <WidgetZone layout={layout} bar="header" slot="right" />
        {!isMac && (
          <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => window.api.windowControls.minimize()}
              aria-label="Minimize"
              className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
            >
              <Minus className="h-3.5 w-3.5 text-text-secondary" />
            </button>
            <button
              type="button"
              onClick={() => window.api.windowControls.maximize()}
              aria-label="Maximize"
              className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
            >
              <Square className="h-3 w-3 text-text-secondary" />
            </button>
            <button
              type="button"
              onClick={() => window.api.windowControls.close()}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-500/80"
            >
              <X className="h-3.5 w-3.5 text-text-secondary" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
