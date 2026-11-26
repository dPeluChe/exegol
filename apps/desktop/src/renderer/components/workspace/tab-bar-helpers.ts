import { FolderTree, GitBranch, Globe, Terminal } from "lucide-react";
import { needsYou } from "../../lib/agent-groups";
import type { AgentState, AttentionItem } from "../../stores/agents";
import {
  collectPaneIds,
  findFirstPaneId,
  type LayoutNode,
  type Pane,
} from "../../stores/workspace";

// ─── T70: Activity dot for tab chrome ───────────────────────────────────────

const ACTIVITY_DOT_CLASS = {
  busy: "bg-success animate-status-pulse",
  idle: "bg-warning",
};

// ─── Tab status: every session in the tab counts, not only its first pane ───

interface TabSignal {
  needsYou: boolean;
  /** Any unread item, "task completed" included: a dot, not the badge */
  unread: boolean;
  activity: keyof typeof ACTIVITY_DOT_CLASS | undefined;
}

export function tabSignal(
  paneIds: string[],
  panes: Record<string, Pane>,
  agents: Record<string, Pick<AgentState, "status" | "activityLevel">>,
  attention: Record<string, Pick<AttentionItem, "level" | "read">>,
): TabSignal {
  const signal: TabSignal = { needsYou: false, unread: false, activity: undefined };
  for (const paneId of paneIds) {
    const agentId = panes[paneId]?.agentId;
    const agent = agentId ? agents[agentId] : undefined;
    if (!agentId || !agent) continue;
    const item = attention[agentId];
    signal.needsYou ||= needsYou(agent, item);
    signal.unread ||= item?.read === false;
    if (agent.activityLevel === "busy") signal.activity = "busy";
    else if (agent.activityLevel === "idle") signal.activity ??= "idle";
  }
  return signal;
}

export function tabDotClass({ needsYou, unread, activity }: TabSignal): string | null {
  if (needsYou || unread) return "animate-pulse bg-amber-400";
  return activity ? ACTIVITY_DOT_CLASS[activity] : null;
}

// ─── Tab auto-naming helpers ────────────────────────────────────────────────

export function tabLabel(tab: { label: string }, index: number): string {
  return tab.label || `Tab ${index + 1}`;
}

export const PANE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  browser: Globe,
  files: FolderTree,
  git: GitBranch,
};

const PANE_TYPE_NAMES: Record<string, string> = { browser: "Browser", git: "Git", files: "Files" };

type TabAgent = { cliType: string; alias?: string | null };

/** A label the app wrote from the agent (its cliType or CLI name, "Claude Code"), not the user */
function isAgentLabel(label: string, agent: TabAgent): boolean {
  return (
    label === agent.cliType ||
    label === agent.alias ||
    label.toLowerCase().replace(/\s+/g, "-") === agent.cliType
  );
}

const sessionName = (agent: TabAgent) => agent.alias ?? agent.cliType;

/** The agent sessions a tab holds, in pane order: shells, browsers and files do not name it */
function tabSessions(
  layout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, TabAgent>,
): TabAgent[] {
  return collectPaneIds(layout).flatMap((id) => {
    const agentId = panes[id]?.type === "terminal" ? panes[id]?.agentId : undefined;
    const agent = agentId ? agents[agentId] : undefined;
    return agent?.cliType && agent.cliType !== "shell" ? [agent] : [];
  });
}

/** A name typed for a tab that one of its sessions already has: it would read as that session */
export function tabNameTaken(
  name: string,
  layout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, TabAgent>,
): boolean {
  const typed = name.trim().toLowerCase();
  return tabSessions(layout, panes, agents).some(
    (a) => sessionName(a).toLowerCase() === typed || isAgentLabel(name.trim(), a),
  );
}

/** Derive display name and icon. One session names its tab ("lupus"), more add a count
 *  ("lupus +2", `sessions` lists them); a name the user typed stays */
export function getTabMeta(
  tabLabel: string,
  tabLayout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, TabAgent>,
): {
  displayName: string;
  Icon: React.ComponentType<{ className?: string }> | null;
  /** Set for an agent tab: the tab shows that CLI's icon, as the sidebar does */
  agentCliType: string | null;
  /** The session names, set only when the tab holds more than one */
  sessions: string[] | null;
} {
  const firstPaneId = findFirstPaneId(tabLayout);
  const firstPane = firstPaneId ? panes[firstPaneId] : null;
  const firstPaneAgent =
    firstPane?.type === "terminal" && firstPane.agentId ? agents[firstPane.agentId] : undefined;
  const firstAgent = firstPaneAgent?.cliType ? firstPaneAgent : undefined;
  const sessions = tabSessions(tabLayout, panes, agents);
  const lead = sessions[0];
  const agentCliType = lead?.cliType ?? null;
  const Icon = lead ? Terminal : firstPane ? (PANE_TYPE_ICONS[firstPane.type] ?? null) : null;
  const names = sessions.length > 1 ? sessions.map(sessionName) : null;

  const isDefault =
    !tabLabel ||
    tabLabel.startsWith("Tab ") ||
    tabLabel === "Workspace" ||
    tabLabel === "Terminal" ||
    sessions.some((a) => isAgentLabel(tabLabel, a)) ||
    (!!firstAgent && isAgentLabel(tabLabel, firstAgent));
  if (!isDefault) return { displayName: tabLabel, Icon, agentCliType, sessions: names };

  if (lead) {
    const more = sessions.length - 1;
    const displayName = more > 0 ? `${sessionName(lead)} +${more}` : sessionName(lead);
    return { displayName, Icon, agentCliType, sessions: names };
  }
  const name = firstAgent
    ? sessionName(firstAgent)
    : (PANE_TYPE_NAMES[firstPane?.type ?? ""] ?? (tabLabel || "Tab"));
  return { displayName: name, Icon, agentCliType, sessions: null };
}
