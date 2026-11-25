import { switchSection } from "../lib/switch-section";
import { useAppStore } from "./app";
import { collectPaneIds, useWorkspaceStore } from "./workspace";

/** Locate the workspace tab + pane showing a given agent, across all projects. */
export function findAgentPane(
  agentId: string,
  projectId: string,
): { tabId: string; paneId: string } | null {
  const pw = useWorkspaceStore.getState().projectWorkspaces[projectId];
  if (!pw) return null;
  for (const tab of pw.tabs) {
    for (const paneId of collectPaneIds(tab.layout)) {
      if (pw.panes[paneId]?.agentId === agentId) {
        return { tabId: tab.id, paneId };
      }
    }
  }
  return null;
}

/** The tab holding a pane of a project */
export function findPane(
  projectId: string,
  paneId: string,
): { tabId: string; paneId: string } | null {
  const pw = useWorkspaceStore.getState().projectWorkspaces[projectId];
  const tab = pw?.tabs.find((t) => collectPaneIds(t.layout).includes(paneId));
  return tab ? { tabId: tab.id, paneId } : null;
}

/** Bring a project's workspace on screen from anywhere, the Dashboard included */
export function showProject(projectId: string): void {
  if (useAppStore.getState().activeProjectId !== projectId) {
    useAppStore.getState().setActiveProject(projectId);
  }
  switchSection("agents");
}

/** Show a project's tab (and pane) */
export function focusPane(projectId: string, tabId: string, paneId?: string): void {
  showProject(projectId);
  useWorkspaceStore.getState().setActiveTab(tabId, paneId);
}
