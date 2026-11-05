import { ENDED_STATUSES, type InterruptionLevel, LIVE_STATUSES } from "@exegol/shared";
import type { AgentState, AttentionItem } from "../stores/agents";
import { needsYou } from "./agent-groups";

export type DeskState = "needs" | "stuck" | "working" | "idle" | "suspended";

export type DeskActivity = "edits" | "command" | "browser" | "thinking" | "question" | "message";

type DeskAgent = Pick<
  AgentState,
  "id" | "projectId" | "cliType" | "status" | "suspended" | "activityLevel"
>;

export function deskState(a: DeskAgent, item: AttentionItem | undefined): DeskState {
  if (a.suspended) return "suspended";
  if (needsYou(a, item)) return "needs";
  if (item?.stuck && a.activityLevel === "busy") return "stuck";
  return a.activityLevel === "busy" ? "working" : "idle";
}

function toolActivity(tool: string): DeskActivity {
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/.test(tool)) return "edits";
  if (/^(Bash|shell|exec_command)$/.test(tool)) return "command";
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.includes("browser_")) return "browser";
  if (tool.endsWith("agent_send")) return "message";
  return "thinking";
}

/** A CLI with no hooks has no tool name: busy is all that is known about it */
export function deskActivity(
  a: DeskAgent,
  item: AttentionItem | undefined,
  tool: string | undefined,
): DeskActivity | null {
  if (needsYou(a, item)) return "question";
  if (a.suspended || a.activityLevel !== "busy") return null;
  if (a.cliType === "shell") return "command";
  return tool ? toolActivity(tool) : "thinking";
}

export interface Room<A> {
  projectId: string;
  desks: A[];
}

/** Rooms and their desks keep one order, so a desk changing state never moves under the pointer */
export function buildRooms<A extends DeskAgent & { archived?: boolean; startedAt: number | null }>(
  agents: Iterable<A>,
): Room<A>[] {
  const rooms = new Map<string, A[]>();
  for (const a of agents) {
    if (a.archived || !LIVE_STATUSES.has(a.status)) continue;
    rooms.set(a.projectId, [...(rooms.get(a.projectId) ?? []), a]);
  }
  return [...rooms]
    .map(([projectId, desks]) => ({
      projectId,
      desks: desks.sort(
        (x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0) || (x.id < y.id ? -1 : 1),
      ),
    }))
    .sort((x, y) => (x.projectId < y.projectId ? -1 : 1));
}

export interface TodayStrip<A> {
  needs: A[];
  stuck: A[];
  canWait: A[];
  done: A[];
}

type TodayAgent = DeskAgent & { archived?: boolean; activitySince?: number };

export function todayStrip<A extends TodayAgent>(
  agents: Iterable<A>,
  attention: Record<string, AttentionItem>,
  ctx: {
    levelOf: (projectId: string) => InterruptionLevel;
    /** CLIs with a newer release */
    outdated: ReadonlySet<string>;
    /** Ended after this (ms) counts as done */
    since: number;
  },
): TodayStrip<A> {
  const strip: TodayStrip<A> = { needs: [], stuck: [], canWait: [], done: [] };
  for (const a of agents) {
    if (a.archived) continue;
    if (ENDED_STATUSES.has(a.status)) {
      if (a.cliType !== "shell" && (a.activitySince ?? 0) > ctx.since) strip.done.push(a);
      continue;
    }
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
  if (needs.length === 0) return null;
  const at = selected ? needs.indexOf(selected) : -1;
  return needs[(at + 1) % needs.length] ?? null;
}
