import { Activity, Bell, Cuboid, type LucideIcon } from "lucide-react";
import { type AgentState, type AttentionItem, isLiveAgent, useAgentStore } from "../stores/agents";
import type { SidebarView } from "../stores/app";
import type { LiveProjectGroup } from "./live-tabs";

/** Label and icon per sidebar view, in SIDEBAR_VIEWS order (the selector, the rail, the palette) */
export const SIDEBAR_VIEW_META: { id: SidebarView; label: string; icon: LucideIcon }[] = [
  { id: "agents", label: "Agents", icon: Activity },
  { id: "projects", label: "Projects", icon: Cuboid },
  { id: "attention", label: "Needs attention", icon: Bell },
];

/** A session the sidebar counts as live: no shells, suspended ones apart (the rail's own rule) */
export const isLiveSession = (a: Pick<AgentState, "cliType" | "status" | "suspended">) =>
  isLiveAgent(a) && !a.suspended;

export const isBusy = (a: Pick<AgentState, "activityLevel"> | undefined) =>
  a?.activityLevel === "busy";

/** "Active only": working now, or waiting on the user with an unread attention item */
export const isActiveOrWaiting = (
  a: AgentState | undefined,
  attention: Record<string, AttentionItem>,
) => !!a && (isBusy(a) || attention[a.id]?.read === false);

/** "Active only": the cards keep their active sessions; a tab or card left empty is dropped */
export function activeCards(
  cards: LiveProjectGroup[],
  agents: Record<string, AgentState>,
  attention: Record<string, AttentionItem>,
): LiveProjectGroup[] {
  return cards.flatMap((card) => {
    const tabs = card.tabs.flatMap((tab) => {
      const agentIds = tab.agentIds.filter((id) => isActiveOrWaiting(agents[id], attention));
      return agentIds.length > 0 ? [{ ...tab, agentIds }] : [];
    });
    return tabs.length > 0 ? [{ ...card, tabs }] : [];
  });
}

export function liveSessionCount(agents: Record<string, AgentState>): number {
  let n = 0;
  for (const id in agents) {
    const a = agents[id];
    if (a && isLiveSession(a)) n++;
  }
  return n;
}

/** The badges of the sidebar's views, shared by the sidebar and the collapsed rail */
export function useSidebarCounts() {
  const live = useAgentStore((s) => liveSessionCount(s.agents));
  const attention = useAgentStore((s) => {
    let n = 0;
    for (const id in s.attentionItems) if (s.attentionItems[id]) n++;
    return n;
  });
  const unread = useAgentStore((s) => s.unreadAttentionCount);
  return { live, attention, unread };
}
