import { type InterruptionLevel, LIVE_STATUSES } from "@exegol/shared";
import type { AgentState, AttentionItem } from "../stores/agents";
import type { DeskActivity } from "../stores/desk-activity";
import { collectPaneIds } from "../stores/workspace/helpers";
import type { ProjectWorkspace, WorkspaceTab } from "../stores/workspace/types";
import { agentGroup, needsYou } from "./agent-groups";
import { isBusy } from "./sidebar-views";

export type DeskState = "needs" | "stuck" | "working" | "idle" | "suspended";

export function deskState(a: AgentState, item: AttentionItem | undefined): DeskState {
  if (a.suspended) return "suspended";
  const group = agentGroup(a, item);
  if (group === "needYou") return "needs";
  if (group === "waiting") return "idle";
  // Raised in an earlier turn: it says nothing about this one
  const stuck = item?.stuck && item.timestamp >= (a.activitySince ?? 0);
  return stuck ? "stuck" : "working";
}

/** A CLI with no hooks has no tool name: busy is all that is known about it */
export function deskActivity(
  a: AgentState,
  item: AttentionItem | undefined,
  activity: DeskActivity | undefined,
): DeskActivity | "question" | null {
  if (needsYou(a, item)) return "question";
  if (a.suspended || !isBusy(a)) return null;
  if (a.cliType === "shell") return "command";
  return activity ?? "thinking";
}

export interface Room {
  projectId: string;
  desks: AgentState[];
}

const DESK_RANK: Record<DeskState, number> = {
  needs: 0,
  stuck: 1,
  working: 2,
  idle: 3,
  suspended: 4,
};

/** What asks for you first, then the latest state change: a desk only moves when its state does */
export function buildRooms(
  agents: Iterable<AgentState>,
  attention: Record<string, AttentionItem>,
): Room[] {
  const rank = (a: AgentState) => DESK_RANK[deskState(a, attention[a.id])];
  const byUrgency = (x: AgentState, y: AgentState) =>
    rank(x) - rank(y) || (y.activitySince ?? 0) - (x.activitySince ?? 0);
  const rooms = new Map<string, AgentState[]>();
  for (const a of agents) {
    if (a.archived || !LIVE_STATUSES.has(a.status)) continue;
    rooms.set(a.projectId, [...(rooms.get(a.projectId) ?? []), a]);
  }
  const sorted = [...rooms].map(([projectId, desks]) => ({
    projectId,
    desks: desks.sort((x, y) => byUrgency(x, y) || (x.id < y.id ? -1 : 1)),
  }));
  return sorted.sort(
    (x, y) =>
      (x.desks[0] && y.desks[0] ? byUrgency(x.desks[0], y.desks[0]) : 0) ||
      (x.projectId < y.projectId ? -1 : 1),
  );
}

export interface TodayStrip {
  needs: AgentState[];
  stuck: AgentState[];
  canWait: AgentState[];
}

export function todayStrip(
  agents: Iterable<AgentState>,
  attention: Record<string, AttentionItem>,
  ctx: {
    levelOf: (projectId: string) => InterruptionLevel;
    /** CLIs with a newer release */
    outdated: ReadonlySet<string>;
  },
): TodayStrip {
  const strip: TodayStrip = { needs: [], stuck: [], canWait: [] };
  for (const a of agents) {
    if (a.archived || !LIVE_STATUSES.has(a.status)) continue;
    const item = attention[a.id];
    const level = ctx.levelOf(a.projectId);
    const state = deskState(a, item);
    if (state === "needs") {
      if (level !== "none") strip.needs.push(a);
    } else if (state === "stuck") {
      strip.stuck.push(a);
    } else if (level === "all" && a.cliType !== "shell") {
      if (ctx.outdated.has(a.cliType) || (item && !item.read)) strip.canWait.push(a);
    }
  }
  return strip;
}

/** P: the next one after the selection, round the list */
export function nextNeedsYou(needs: string[], selected: string | null): string | null {
  return needs[(needs.indexOf(selected ?? "") + 1) % needs.length] ?? null;
}

/** Sessions sharing a tab with a browser pane */
export function besideBrowser(workspace: ProjectWorkspace | undefined): Set<string> {
  const ids = new Set<string>();
  for (const tab of workspace?.tabs ?? []) {
    const panes = collectPaneIds(tab.layout).map((id) => workspace?.panes[id]);
    if (!panes.some((p) => p?.type === "browser")) continue;
    for (const p of panes) if (p?.agentId) ids.add(p.agentId);
  }
  return ids;
}

/** What a shell runs right now */
export function shellCommand(a: AgentState): string | null {
  return a.cliType === "shell" && !a.suspended ? a.currentStep : null;
}

export interface DeskGroup {
  /** null: sessions in no tab */
  tabId: string | null;
  label: string | null;
  desks: AgentState[];
}

/** Desks by the tab holding them, tabs in the order of their most urgent desk */
export function groupByTab(
  desks: AgentState[],
  workspace: ProjectWorkspace | undefined,
): DeskGroup[] {
  const tabOf = new Map<string, WorkspaceTab>();
  for (const tab of workspace?.tabs ?? []) {
    for (const id of collectPaneIds(tab.layout)) {
      const agentId = workspace?.panes[id]?.agentId;
      if (agentId) tabOf.set(agentId, tab);
    }
  }
  const groups = new Map<string | null, DeskGroup>();
  for (const desk of desks) {
    const tab = tabOf.get(desk.id);
    const tabId = tab?.id ?? null;
    const group = groups.get(tabId) ?? { tabId, label: tab?.label ?? null, desks: [] };
    group.desks.push(desk);
    groups.set(tabId, group);
  }
  return [...groups.values()];
}
