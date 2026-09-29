import { useMemo } from "react";
import { type AgentState, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { collectPaneIds, useWorkspaceStore } from "../stores/workspace";
import type { ProjectWorkspace } from "../stores/workspace/types";

export const LIVE_STATUSES_UI = new Set(["running", "spawning", "waiting_input"]);

/** A workspace tab (layout) with live sessions: what Cmd+2..9 jumps to */
export interface LiveTabGroup {
  key: string;
  projectId: string;
  tabId: string;
  tabLabel: string;
  agentIds: string[];
}

export function computeLiveTabGroups(
  projectWorkspaces: Record<string, ProjectWorkspace>,
  agents: Record<string, AgentState>,
  order: string[],
): LiveTabGroup[] {
  const groups: LiveTabGroup[] = [];
  for (const [projectId, pw] of Object.entries(projectWorkspaces)) {
    for (const tab of pw.tabs) {
      const agentIds = collectPaneIds(tab.layout)
        .map((paneId) => pw.panes[paneId]?.agentId)
        .filter((id): id is string => !!id && LIVE_STATUSES_UI.has(agents[id]?.status ?? ""));
      if (agentIds.length > 0) {
        groups.push({
          key: `${projectId}:${tab.id}`,
          projectId,
          tabId: tab.id,
          tabLabel: tab.label,
          agentIds,
        });
      }
    }
  }
  // The user's drag order first; new tabs keep their natural place after it
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.key) - rank(b.g.key) || a.i - b.i)
    .map(({ g }) => g);
}

export function getLiveTabGroups(): LiveTabGroup[] {
  return computeLiveTabGroups(
    useWorkspaceStore.getState().projectWorkspaces,
    useAgentStore.getState().agents,
    useAppStore.getState().liveTabOrder,
  );
}

export function useLiveTabGroups(): LiveTabGroup[] {
  const projectWorkspaces = useWorkspaceStore((s) => s.projectWorkspaces);
  const agents = useAgentStore((s) => s.agents);
  const order = useAppStore((s) => s.liveTabOrder);
  return useMemo(
    () => computeLiveTabGroups(projectWorkspaces, agents, order),
    [projectWorkspaces, agents, order],
  );
}

/** Cmd+1 is the Dashboard, so a group at index i answers to Cmd+(i+2), up to Cmd+9 */
export function groupShortcut(index: number): string | null {
  return index <= 7 ? `⌘${index + 2}` : null;
}

/** Drop `drag` on `target`: below it when moving down, above it when moving up */
export function reorderKeys(all: string[], drag: string, target: string): string[] {
  if (drag === target || !all.includes(drag) || !all.includes(target)) return all;
  const movingDown = all.indexOf(drag) < all.indexOf(target);
  const keys = all.filter((k) => k !== drag);
  keys.splice(keys.indexOf(target) + (movingDown ? 1 : 0), 0, drag);
  return keys;
}
