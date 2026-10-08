import type { AgentState } from "../stores/agents";
import type { LiveProjectGroup } from "./live-tabs";

export const SIDEBAR_VIEWS = ["agents", "projects", "attention"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

export const isSidebarView = (value: unknown): value is SidebarView =>
  SIDEBAR_VIEWS.includes(value as SidebarView);

/** The sessions the Agents view lists (shells included) */
export const SIDEBAR_SESSION_STATUSES = new Set(["running", "spawning", "waiting_input"]);

export const liveSessionCount = (agents: Record<string, Pick<AgentState, "status">>) =>
  Object.values(agents).filter((a) => SIDEBAR_SESSION_STATUSES.has(a.status)).length;

/** "Active only": the cards keep their busy sessions; a tab or card left empty is dropped */
export function busyCards(
  cards: LiveProjectGroup[],
  agents: Record<string, AgentState>,
): LiveProjectGroup[] {
  return cards.flatMap((card) => {
    const tabs = card.tabs.flatMap((tab) => {
      const agentIds = tab.agentIds.filter((id) => agents[id]?.activityLevel === "busy");
      return agentIds.length > 0 ? [{ ...tab, agentIds }] : [];
    });
    return tabs.length > 0 ? [{ ...card, tabs }] : [];
  });
}
