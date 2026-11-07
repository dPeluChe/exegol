import { type DeskActivity, type InterruptionLevel, LIVE_STATUSES } from "@exegol/shared";
import type { AgentState, AttentionItem } from "../stores/agents";
import { collectPaneIds } from "../stores/workspace/helpers";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { agentGroup, needsYou } from "./agent-groups";
import { isBusy } from "./sidebar-views";

export type DeskState = "needs" | "stuck" | "unread" | "working" | "idle" | "suspended";

export function deskState(
  a: AgentState,
  item: AttentionItem | undefined,
  unseen = false,
): DeskState {
  if (a.suspended) return "suspended";
  const group = agentGroup(a, item, unseen);
  if (group === "needYou") return "needs";
  if (group === "unread") return "unread";
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
): DeskActivity | null {
  if (needsYou(a, item) || a.suspended || !isBusy(a)) return null;
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
  unread: 2,
  working: 3,
  idle: 4,
  suspended: 5,
};

/** What asks for you first, then the latest state change: a desk only moves when its state does */
export function buildRooms(
  agents: Iterable<AgentState>,
  attention: Record<string, AttentionItem>,
  unseen: Record<string, string> = {},
): Room[] {
  const ranks = new Map<string, number>();
  const byUrgency = (x: AgentState, y: AgentState) =>
    (ranks.get(x.id) ?? 0) - (ranks.get(y.id) ?? 0) ||
    (y.activitySince ?? 0) - (x.activitySince ?? 0);
  const rooms = new Map<string, AgentState[]>();
  for (const a of agents) {
    if (a.archived || !LIVE_STATUSES.has(a.status)) continue;
    ranks.set(a.id, DESK_RANK[deskState(a, attention[a.id], a.id in unseen)]);
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
    unseen?: Record<string, string>;
  },
): TodayStrip {
  const strip: TodayStrip = { needs: [], stuck: [], canWait: [] };
  for (const a of agents) {
    if (a.archived || !LIVE_STATUSES.has(a.status)) continue;
    const item = attention[a.id];
    const level = ctx.levelOf(a.projectId);
    const state = deskState(a, item, !!ctx.unseen && a.id in ctx.unseen);
    if (state === "needs") {
      if (level !== "none") strip.needs.push(a);
    } else if (state === "stuck") {
      strip.stuck.push(a);
    } else if (level === "all" && a.cliType !== "shell") {
      if (ctx.outdated.has(a.cliType) || (item && !item.read) || state === "unread") {
        strip.canWait.push(a);
      }
    }
  }
  return strip;
}

/** What a shell runs right now */
export function shellCommand(a: AgentState): string | null {
  return a.cliType === "shell" && !a.suspended ? a.currentStep : null;
}

export interface DeskGroup {
  /** null: sessions in no tab */
  tabId: string | null;
  label: string | null;
  /** The tab holds a browser pane */
  browser: boolean;
  desks: AgentState[];
}

/** Desks by the tab holding them, tabs in the order of their most urgent desk */
export function groupByTab(
  desks: AgentState[],
  workspace: ProjectWorkspace | undefined,
): DeskGroup[] {
  const groupOf = new Map<string, DeskGroup>();
  for (const tab of workspace?.tabs ?? []) {
    const panes = collectPaneIds(tab.layout).map((id) => workspace?.panes[id]);
    const browser = panes.some((p) => p?.type === "browser");
    const group = { tabId: tab.id, label: tab.label, browser, desks: [] };
    for (const p of panes) if (p?.agentId) groupOf.set(p.agentId, group);
  }
  const noTab: DeskGroup = { tabId: null, label: null, browser: false, desks: [] };
  const groups = new Set<DeskGroup>();
  for (const desk of desks) {
    const group = groupOf.get(desk.id) ?? noTab;
    group.desks.push(desk);
    groups.add(group);
  }
  return [...groups];
}
