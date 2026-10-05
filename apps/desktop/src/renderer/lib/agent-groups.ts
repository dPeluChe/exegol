import { LIVE_STATUSES } from "@exegol/shared";
import type { AgentState, AttentionItem } from "../stores/agents";

export type AgentGroup = "needYou" | "working" | "waiting";

export const AGENT_GROUP_ORDER: AgentGroup[] = ["needYou", "working", "waiting"];

type Grouped = Pick<
  AgentState,
  "id" | "cliType" | "status" | "activityLevel" | "activitySince" | "archived"
>;

/** Need you: an unread question, or a dialog still open (its action_needed item lives until the
 *  agent runs again). Working: busy. Everything else live is waiting */
export function agentGroup(a: Grouped, item: AttentionItem | undefined): AgentGroup {
  if (item?.level === "action_needed" && (!item.read || a.status === "waiting_input")) {
    return "needYou";
  }
  return a.activityLevel === "busy" ? "working" : "waiting";
}

/** Live, non-shell, non-archived sessions by group, the longest in their state first */
export function groupAgents<T extends Grouped>(
  agents: Iterable<T>,
  attention: Record<string, AttentionItem>,
): Record<AgentGroup, T[]> {
  const groups: Record<AgentGroup, T[]> = { needYou: [], working: [], waiting: [] };
  for (const a of agents) {
    if (a.cliType === "shell" || a.archived || !LIVE_STATUSES.has(a.status)) continue;
    groups[agentGroup(a, attention[a.id])].push(a);
  }
  const since = (a: T) => a.activitySince ?? Number.POSITIVE_INFINITY;
  for (const list of Object.values(groups)) list.sort((x, y) => since(x) - since(y));
  return groups;
}
