import { getTabMeta } from "../components/workspace/tab-bar-helpers";
import { useAgentStore } from "../stores/agents";
import {
  collectPaneIds,
  getProjectState,
  layoutHasPane,
  useWorkspaceStore,
} from "../stores/workspace";
import { dispatchRefitTerminals } from "./dispatch-refit";
import { focusNewPane } from "./pane-focus";

/** Where a pane can go: another tab of its project, or "new" for a tab of its own */
export interface MoveTarget {
  tabId: string | "new";
  label: string;
}

/** The tabs a pane can move to, named as the tab bar names them; none while it floats */
export function paneMoveTargets(paneId: string): MoveTarget[] {
  if (useWorkspaceStore.getState().floatingPanes[paneId]) return [];
  const { tabs, panes } = getProjectState();
  const from = tabs.find((t) => layoutHasPane(t.layout, paneId));
  if (!from) return [];
  const agents = useAgentStore.getState().agents;
  const targets: MoveTarget[] = tabs
    .filter((t) => t.id !== from.id)
    .map((t) => ({ tabId: t.id, label: getTabMeta(t.label, t.layout, panes, agents).displayName }));
  if (collectPaneIds(from.layout).length > 1) targets.push({ tabId: "new", label: "New Tab" });
  return targets;
}

/** Move a pane to another tab (or a new one): its session keeps running, the pane remounts there
 *  focused, as a project switch remounts it */
export function movePane(paneId: string, toTabId: string | "new"): void {
  const store = useWorkspaceStore.getState();
  const from = getProjectState().tabs.find((t) => layoutHasPane(t.layout, paneId));
  if (!from) return;
  if (toTabId === "new") store.extractPaneToNewTab(from.id, paneId);
  else store.movePaneToTab(from.id, paneId, toTabId);
  dispatchRefitTerminals();
  focusNewPane(paneId);
}
