import { useMemo } from "react";
import { type AgentState, showProject, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { SHORTCUT_DIGITS, type ShortcutDigit, useShortcutStore } from "../stores/shortcuts";
import { useWatchStore } from "../stores/watch";
import { collectPaneIds, useWorkspaceStore } from "../stores/workspace";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { chordBadge } from "./keymap";

const LIVE_STATUSES_UI = new Set(["running", "spawning", "waiting_input"]);

/** A workspace tab (layout) with live sessions, listed in the sidebar */
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

function getLiveTabGroups(): LiveTabGroup[] {
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

/**
 * The digit each project answers to (Cmd+digit). A number the user gave a project is kept, live
 * or idle. The free numbers go one per project with live tabs, in the sidebar's order (a project
 * sits where its first group does), projects whose every session is pinned last (the Dashboard,
 * Cmd+1, already reaches them). Past the ninth, a project has none.
 */
export function assignProjectShortcuts(
  groups: LiveTabGroup[],
  assigned: Record<string, ShortcutDigit>,
  pinned: ReadonlySet<string>,
): Map<string, ShortcutDigit> {
  const byProject = new Map<string, ShortcutDigit>(Object.entries(assigned));
  const agentsOf = new Map<string, string[]>();
  for (const g of groups)
    agentsOf.set(g.projectId, [...(agentsOf.get(g.projectId) ?? []), ...g.agentIds]);
  const rest = [...agentsOf.keys()].filter((id) => !byProject.has(id));
  const allPinned = (id: string) => (agentsOf.get(id) ?? []).every((a) => pinned.has(a));
  const ordered = [...rest.filter((id) => !allPinned(id)), ...rest.filter(allPinned)];
  const reserved = new Set(Object.values(assigned));
  const free = SHORTCUT_DIGITS.filter((d) => !reserved.has(d));
  ordered.forEach((id, i) => {
    const digit = free[i];
    if (digit) byProject.set(id, digit);
  });
  return byProject;
}

export function useProjectShortcuts(): Map<string, ShortcutDigit> {
  const live = useLiveTabGroups();
  const assigned = useShortcutStore((s) => s.assigned);
  const watched = useWatchStore((s) => s.watched);
  return useMemo(
    () => assignProjectShortcuts(live, assigned, new Set(watched)),
    [live, assigned, watched],
  );
}

/**
 * Cmd+digit: shows the project as it was left (its tab and pane). Returns the group key to flash:
 * the project's active tab when it is live, else its first live tab
 */
export function goToShortcut(digit: string): string | null {
  const groups = getLiveTabGroups();
  const byProject = assignProjectShortcuts(
    groups,
    useShortcutStore.getState().assigned,
    new Set(useWatchStore.getState().watched),
  );
  const projectId = [...byProject].find(([, d]) => d === digit)?.[0];
  if (!projectId) return null;
  showProject(projectId);
  const tabId = useWorkspaceStore.getState().projectWorkspaces[projectId]?.activeTabId;
  const own = groups.filter((g) => g.projectId === projectId);
  const key = own.find((g) => g.tabId === tabId)?.key ?? own[0]?.key;
  return key ?? (tabId ? `${projectId}:${tabId}` : null);
}

/** How a digit reads next to its group or project */
export const shortcutLabel = (digit: ShortcutDigit | undefined) =>
  digit ? chordBadge(digit) : null;

/** Drop `drag` on `target`: below it when moving down, above it when moving up */
export function reorderKeys(all: string[], drag: string, target: string): string[] {
  if (drag === target || !all.includes(drag) || !all.includes(target)) return all;
  const movingDown = all.indexOf(drag) < all.indexOf(target);
  const keys = all.filter((k) => k !== drag);
  keys.splice(keys.indexOf(target) + (movingDown ? 1 : 0), 0, drag);
  return keys;
}
