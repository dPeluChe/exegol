import { useMemo } from "react";
import { type AgentState, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { SHORTCUT_DIGITS, type ShortcutDigit, useShortcutStore } from "../stores/shortcuts";
import { useWatchStore } from "../stores/watch";
import { collectPaneIds, useWorkspaceStore } from "../stores/workspace";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { chordBadge } from "./keymap";

const LIVE_STATUSES_UI = new Set(["running", "spawning", "waiting_input"]);

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
 * The digit each live tab group answers to (Cmd+digit). A number the user gave a project goes to
 * its first live group and stays reserved while the project is idle. The others fill the free
 * numbers in the sidebar's order, groups whose every session is pinned last (the Dashboard,
 * Cmd+1, already reaches them). Past the ninth, a group has none.
 */
export function assignGroupShortcuts(
  groups: LiveTabGroup[],
  assigned: Record<string, ShortcutDigit>,
  pinned: ReadonlySet<string>,
): Map<string, ShortcutDigit> {
  const byGroup = new Map<string, ShortcutDigit>();
  const served = new Set<string>();
  for (const g of groups) {
    const digit = assigned[g.projectId];
    if (digit && !served.has(g.projectId)) {
      byGroup.set(g.key, digit);
      served.add(g.projectId);
    }
  }
  const rest = groups.filter((g) => !byGroup.has(g.key));
  const allPinned = (g: LiveTabGroup) => g.agentIds.every((id) => pinned.has(id));
  const ordered = [...rest.filter((g) => !allPinned(g)), ...rest.filter(allPinned)];
  const reserved = new Set(Object.values(assigned));
  const free = SHORTCUT_DIGITS.filter((d) => !reserved.has(d));
  ordered.forEach((g, i) => {
    const digit = free[i];
    if (digit) byGroup.set(g.key, digit);
  });
  return byGroup;
}

/** Each project's shortcut: the one of its first live group that has one */
export function projectShortcuts(
  groups: LiveTabGroup[],
  byGroup: Map<string, ShortcutDigit>,
): Map<string, ShortcutDigit> {
  const byProject = new Map<string, ShortcutDigit>();
  for (const g of groups) {
    const digit = byGroup.get(g.key);
    if (digit && !byProject.has(g.projectId)) byProject.set(g.projectId, digit);
  }
  return byProject;
}

export function useGroupShortcuts(groups: LiveTabGroup[]): Map<string, ShortcutDigit> {
  const assigned = useShortcutStore((s) => s.assigned);
  const watched = useWatchStore((s) => s.watched);
  return useMemo(
    () => assignGroupShortcuts(groups, assigned, new Set(watched)),
    [groups, assigned, watched],
  );
}

export function useProjectShortcuts(): Map<string, ShortcutDigit> {
  const groups = useLiveTabGroups();
  const byGroup = useGroupShortcuts(groups);
  return useMemo(() => projectShortcuts(groups, byGroup), [groups, byGroup]);
}

/** The live group Cmd+digit jumps to (for the hotkey, outside React) */
export function groupForDigit(digit: string): LiveTabGroup | undefined {
  const groups = getLiveTabGroups();
  const byGroup = assignGroupShortcuts(
    groups,
    useShortcutStore.getState().assigned,
    new Set(useWatchStore.getState().watched),
  );
  return groups.find((g) => byGroup.get(g.key) === digit);
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
