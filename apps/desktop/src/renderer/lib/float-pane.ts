import { type Pane, useWorkspaceStore } from "../stores/workspace";
import { sizeKey } from "./browser-viewports";

/** Opens a terminal (with an agent) or browser (with a URL) pane in an always-on-top window */
export function floatPane(
  paneId: string,
  pane: Pane,
  projectId: string | null | undefined,
  markPaneFloating: (paneId: string, type: "terminal" | "browser") => void,
) {
  if (pane.type === "terminal" && pane.agentId) {
    markPaneFloating(paneId, "terminal");
    window.api.floating.open({
      paneId,
      type: "terminal",
      title: `Terminal — ${pane.agentId.slice(0, 8)}`,
      agentId: pane.agentId,
    });
  } else if (pane.type === "browser" && pane.url) {
    markPaneFloating(paneId, "browser");
    window.api.floating.open({
      paneId,
      type: "browser",
      title: "Browser",
      url: pane.url,
      // The floating browser lists the project's agents from it
      projectId: projectId ?? undefined,
      viewport: pane.viewport ? sizeKey(pane.viewport) : undefined,
    });
  }
}

export const canFloat = (pane: Pane) =>
  Boolean((pane.type === "terminal" && pane.agentId) || (pane.type === "browser" && pane.url));

/** The pane a session shows in, floated: the Dashboard reaches it without being in its project */
export function floatAgentPane(projectId: string, paneId: string): void {
  const pane = useWorkspaceStore.getState().projectWorkspaces[projectId]?.panes[paneId];
  if (!pane || !canFloat(pane)) return;
  floatPane(paneId, pane, projectId, useWorkspaceStore.getState().markPaneFloating);
}
