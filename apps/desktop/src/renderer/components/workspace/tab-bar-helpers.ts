import { FolderTree, GitBranch, Globe, Terminal } from "lucide-react";
import { needsYou } from "../../lib/agent-groups";
import type { AgentState, AttentionItem } from "../../stores/agents";
import { findFirstPaneId, type LayoutNode, type Pane } from "../../stores/workspace";

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

/** A label the app wrote from the agent (its cliType or CLI name, "Claude Code"), not the user */
function isAgentLabel(label: string, agent: { cliType: string; alias?: string | null }): boolean {
  return (
    label === agent.cliType ||
    label === agent.alias ||
    label.toLowerCase().replace(/\s+/g, "-") === agent.cliType
  );
}

/** Derive display name and icon from the tab's primary pane.
 *  An agent tab follows its session: the alias once it has one ("lupus"), else the CLI. */
export function getTabMeta(
  tabLabel: string,
  tabLayout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, { cliType: string; alias?: string | null }>,
): {
  displayName: string;
  Icon: React.ComponentType<{ className?: string }> | null;
  /** Set for an agent tab: the tab shows that CLI's icon, as the sidebar does */
  agentCliType: string | null;
} {
  const firstPaneId = findFirstPaneId(tabLayout);
  const firstPane = firstPaneId ? panes[firstPaneId] : null;
  const Icon = firstPane ? (PANE_TYPE_ICONS[firstPane.type] ?? null) : null;
  const primaryAgentId = firstPane?.type === "terminal" ? (firstPane.agentId ?? null) : null;
  const agent = primaryAgentId ? agents[primaryAgentId] : undefined;
  const agentCliType = agent && agent.cliType !== "shell" ? agent.cliType : null;

  // If user explicitly renamed the tab (not a default name), respect it
  const isDefault =
    tabLabel.startsWith("Tab ") ||
    tabLabel === "Workspace" ||
    tabLabel === "Terminal" ||
    (!!agent && isAgentLabel(tabLabel, agent));
  if (!isDefault) return { displayName: tabLabel, Icon, agentCliType };

  if (agent)
    return {
      displayName: agent.alias ?? agent.cliType,
      Icon: Terminal,
      agentCliType,
    };
  if (firstPane?.type === "browser") return { displayName: "Browser", Icon: Globe, agentCliType };
  if (firstPane?.type === "git") return { displayName: "Git", Icon: GitBranch, agentCliType };
  if (firstPane?.type === "files") return { displayName: "Files", Icon: FolderTree, agentCliType };

  return { displayName: tabLabel, Icon, agentCliType };
}
