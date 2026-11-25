import { cn } from "@exegol/ui";
import {
  ArrowUpRight,
  Code2,
  Columns,
  Globe,
  PictureInPicture2,
  Rows,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { usePaneProject } from "../../contexts/ProjectScope";
import { closeWithConfirm } from "../../lib/close-target";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { canFloat, floatPane } from "../../lib/float-pane";
import { movePane } from "../../lib/move-pane";
import { openProjectInIde } from "../../lib/open-in-ide";
import { projectBrowserUrl } from "../../lib/project-browser-url";
import { splitAndFocus, splitWithBrowser, splitWithTerminal } from "../../lib/split-terminal";
import { getProjectState, selectPanesOf, useWorkspaceStore } from "../../stores/workspace";
import { closeTargetFor } from "../../stores/workspace/helpers";
import { PaneDragHandle } from "./PaneDragHandle";

// ─── Pane Toolbar ───────────────────────────────────────────────────────────

export function PaneToolbar({
  tabId,
  paneId,
  paneType,
  isSplitPane,
}: {
  tabId: string;
  paneId: string;
  paneType: string;
  isSplitPane: boolean;
}) {
  const markPaneFloating = useWorkspaceStore((s) => s.markPaneFloating);
  const { projectId, project } = usePaneProject();
  const panes = useWorkspaceStore(selectPanesOf(projectId));
  // A terminal offers a browser beside it and a browser a terminal
  const companion =
    paneType === "terminal" ? "browser" : paneType === "browser" ? "terminal" : null;
  const [addOpen, setAddOpen] = useState(false);

  const addCompanion = useCallback(
    async (direction: "horizontal" | "vertical") => {
      setAddOpen(false);
      if (companion === "terminal") return splitWithTerminal(tabId, paneId, direction);
      if (companion !== "browser") return;
      const url = await projectBrowserUrl(projectId, project?.path);
      splitWithBrowser(tabId, paneId, direction, url);
      dispatchRefitTerminals();
    },
    [companion, projectId, project?.path, tabId, paneId],
  );

  const showIdeButton = paneType === "terminal" || paneType === "files";
  const pane = panes[paneId];
  // As the pane menu: a terminal with no session or a browser with no URL has nothing to float
  const showFloatButton = pane !== undefined && canFloat(pane);

  const handleFloat = useCallback(() => {
    if (pane) floatPane(paneId, pane, projectId, markPaneFloating);
  }, [pane, paneId, markPaneFloating, projectId]);

  const handleOpenInIde = useCallback(() => {
    if (!projectId) return;
    openProjectInIde({ projectId });
  }, [projectId]);

  const handleClosePane = useCallback(
    () => closeWithConfirm(closeTargetFor(getProjectState(), tabId, paneId, false)),
    [tabId, paneId],
  );

  return (
    <>
      {isSplitPane && (
        // The grip sits on the pane's left edge, outlined in the accent so it reads as a handle;
        // the action bar keeps a second one for whoever looks there first
        <PaneDragHandle
          paneId={paneId}
          className="absolute top-1/2 left-0.5 z-10 h-10 w-4 -translate-y-1/2 border border-accent bg-bg-secondary/90 opacity-0 transition-opacity group-hover/pane:opacity-100"
          iconClassName="h-3.5 w-3.5"
        />
      )}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-bg-secondary/80 opacity-0 transition-opacity group-hover/pane:opacity-100">
        <PaneDragHandle paneId={paneId} className="h-5 w-5" />
        {showIdeButton && projectId && (
          <button
            type="button"
            onClick={handleOpenInIde}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Open in IDE"
          >
            <Code2 className="h-3 w-3" />
          </button>
        )}
        {isSplitPane && (
          <button
            type="button"
            onClick={() => movePane(paneId, "new")}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Pop out to new tab"
          >
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
        {showFloatButton && (
          <button
            type="button"
            onClick={handleFloat}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Float to separate window"
          >
            <PictureInPicture2 className="h-3 w-3" />
          </button>
        )}
        {companion && (
          // biome-ignore lint/a11y/noStaticElementInteractions: closes the side menu when the pointer leaves it
          <div className="relative" onMouseLeave={() => setAddOpen(false)}>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded hover:bg-white/10 hover:text-text-primary",
                addOpen ? "bg-white/10 text-text-primary" : "text-text-muted",
              )}
              title={companion === "browser" ? "Add a browser beside" : "Add a terminal beside"}
            >
              {companion === "browser" ? (
                <Globe className="h-3 w-3" />
              ) : (
                <TerminalSquare className="h-3 w-3" />
              )}
            </button>
            {addOpen && (
              // pt-1, not a top offset: a gap under the button let the pointer leave and close it
              <div className="absolute right-0 top-full z-20 pt-1">
                <div className="w-28 rounded-md border border-border bg-bg-secondary py-1 shadow-lg">
                  {(
                    [
                      ["horizontal", Columns, "To the right"],
                      ["vertical", Rows, "Below"],
                    ] as const
                  ).map(([dir, Icon, label]) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => addCompanion(dir)}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] text-text-secondary hover:bg-white/10"
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => splitAndFocus(tabId, paneId, "horizontal")}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Split horizontal"
        >
          <Columns className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => splitAndFocus(tabId, paneId, "vertical")}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Split vertical"
        >
          <Rows className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleClosePane}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-red-400/80 hover:text-white"
          title="Close pane"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}
