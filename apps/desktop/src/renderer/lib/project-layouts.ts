import { showProject } from "../stores/agents";
import { toastError } from "../stores/toasts";
import { getProjectState, useWorkspaceStore } from "../stores/workspace";
import { dispatchRefitTerminals } from "./dispatch-refit";
import type { CustomLayoutPreset } from "./layout-presets";
import { fillLayoutSlots, slotAgentOf } from "./spawn-shell";

/** A line under a saved layout's name: what its panes are ("browser · 2 terminals · claude-code") */
export function describeLayout(layout: CustomLayoutPreset): string {
  const counts = new Map<string, number>();
  for (const slot of layout.slotTypes ?? []) {
    const what =
      slot.type === "terminal"
        ? slot.cliType && slot.cliType !== "shell"
          ? slot.cliType
          : "terminal"
        : slot.type;
    counts.set(what, (counts.get(what) ?? 0) + 1);
  }
  return [...counts].map(([what, n]) => (n === 1 ? what : `${n} ${what}s`)).join(" · ");
}

/** The project's current tab: the one a save captures and an apply replaces */
function currentTabId(projectId: string): string | null {
  showProject(projectId);
  return getProjectState().activeTabId;
}

/** Save the project's current tab (shapes, sizes, what each pane runs) under `name` */
export function saveProjectLayout(projectId: string, name: string): string | null {
  const tabId = currentTabId(projectId);
  if (!tabId) return null;
  return useWorkspaceStore
    .getState()
    .saveCustomLayout(tabId, name, { projectId, agentOf: slotAgentOf });
}

/** Rebuild a saved layout: in a new tab named after it, or over the current tab */
export function openProjectLayout(
  projectId: string,
  layout: CustomLayoutPreset,
  where: "new-tab" | "current-tab",
): void {
  showProject(projectId);
  const tabId =
    where === "new-tab"
      ? useWorkspaceStore.getState().addTab(layout.name)
      : getProjectState().activeTabId;
  if (!tabId) return;
  const { spawns } = useWorkspaceStore.getState().applyCustomLayout(tabId, layout.id);
  requestAnimationFrame(() => dispatchRefitTerminals());
  fillLayoutSlots(projectId, spawns).catch(toastError("A terminal of the layout did not start"));
}
