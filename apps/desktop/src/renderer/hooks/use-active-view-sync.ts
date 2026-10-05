import { trpcMutate } from "../lib/trpc-client";
import { useAppStore } from "../stores/app";
import { useWatchStore } from "../stores/watch";
import {
  collectPaneIds,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../stores/workspace";
import { useMountEffect } from "./use-mount-effect";

const SYNC_DELAY_MS = 1_000;

interface ActiveView {
  projectId: string | null;
  agentIds: string[];
}

/** The sessions on screen, focused pane first; null when nothing project-wise is shown */
function currentActiveView(): ActiveView | null {
  const { activeView, activeProjectId } = useAppStore.getState();
  if (activeView === "dashboard") {
    const { watched, open } = useWatchStore.getState();
    return { projectId: null, agentIds: watched.filter((id) => open.includes(id)) };
  }
  if (!activeProjectId) return null;
  const { tabs, activeTabId, panes } = getProjectState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return { projectId: activeProjectId, agentIds: [] };
  const focused = getFocusedOrFirstPaneId(tab);
  const paneIds = collectPaneIds(tab.layout).filter((id) => id !== focused);
  const agentIds = (focused ? [focused, ...paneIds] : paneIds)
    .map((id) => panes[id]?.agentId)
    .filter((id): id is string => !!id);
  return { projectId: activeProjectId, agentIds };
}

/** Main reattaches what was on screen first at the next startup */
export function useActiveViewSync(): void {
  useMountEffect(() => {
    let lastSent = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      timer = null;
      const view = currentActiveView();
      if (!view) return;
      const key = JSON.stringify(view);
      if (key === lastSent) return;
      lastSent = key;
      trpcMutate("agents.setActiveView", view).catch(() => {
        lastSent = "";
      });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, SYNC_DELAY_MS);
    };
    schedule();
    const unsubs = [
      useAppStore.subscribe(schedule),
      useWorkspaceStore.subscribe(schedule),
      useWatchStore.subscribe(schedule),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubs) unsub();
    };
  });
}
