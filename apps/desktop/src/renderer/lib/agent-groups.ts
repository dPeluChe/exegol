import { LIVE_STATUSES } from "@exegol/shared";
import type { AgentState, AttentionItem } from "../stores/agents";

export type AgentGroup = "needYou" | "working" | "unread" | "waiting";

export const AGENT_GROUP_ORDER: AgentGroup[] = ["needYou", "working", "unread", "waiting"];

type Grouped = Pick<
  AgentState,
  "id" | "cliType" | "status" | "activityLevel" | "activitySince" | "archived"
>;

/** An unread question, or a dialog still open (its action_needed item lives until the agent runs again) */
export function needsYou(
  a: Pick<AgentState, "status">,
  item: Pick<AttentionItem, "level" | "read"> | undefined,
): boolean {
  return item?.level === "action_needed" && (!item.read || a.status === "waiting_input");
}

/** Working: busy. Unread: a finished turn nobody has seen yet, to look at when free. The rest waits */
export function agentGroup(
  a: Grouped,
  item: AttentionItem | undefined,
  unseen: boolean,
): AgentGroup {
  if (needsYou(a, item)) return "needYou";
  if (a.activityLevel === "busy") return "working";
  return unseen ? "unread" : "waiting";
}

/** Live, non-shell, non-archived sessions by group, the longest in their state first */
export function groupAgents<T extends Grouped>(
  agents: Iterable<T>,
  attention: Record<string, AttentionItem>,
  unseen: Record<string, string>,
): Record<AgentGroup, T[]> {
  const groups: Record<AgentGroup, T[]> = { needYou: [], working: [], unread: [], waiting: [] };
  for (const a of agents) {
    if (a.cliType === "shell" || a.archived || !LIVE_STATUSES.has(a.status)) continue;
    groups[agentGroup(a, attention[a.id], a.id in unseen)].push(a);
  }
  const since = (a: T) => a.activitySince ?? Number.POSITIVE_INFINITY;
  for (const list of Object.values(groups)) list.sort((x, y) => since(x) - since(y));
  return groups;
}
