import type { AgentActivityLevel } from "@exegol/shared";
import { FolderTree, GitBranch, Globe, Smartphone, Terminal } from "lucide-react";
import { findFirstPaneId, type LayoutNode, type Pane } from "../../stores/workspace";

// ─── T70: Activity dot for tab chrome ───────────────────────────────────────

export const ACTIVITY_DOT_CLASS: Partial<Record<AgentActivityLevel, string>> = {
  busy: "bg-success animate-status-pulse",
  idle: "bg-warning",
};

// ─── Tab auto-naming helpers ────────────────────────────────────────────────

export function tabLabel(tab: { label: string }, index: number): string {
  return tab.label || `Tab ${index + 1}`;
}

export const PANE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  browser: Globe,
  files: FolderTree,
  git: GitBranch,
  simulator: Smartphone,
};

/** A label the app wrote from the agent (its cliType or CLI name, "Claude Code"), not the user */
function isAgentLabel(label: string, agent: { cliType: string; alias?: string | null }): boolean {
  return (
    label === agent.cliType ||
    label === agent.alias ||
    label.toLowerCase().replace(/\s+/g, "-") === agent.cliType
  );
}

/** Derive display name, icon, and primary agent ID from the tab's primary pane.
 *  An agent tab follows its session: the alias once it has one ("lupus"), else the CLI. */
export function getTabMeta(
  tabLabel: string,
  tabLayout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, { cliType: string; alias?: string | null }>,
): {
  displayName: string;
  Icon: React.ComponentType<{ className?: string }> | null;
  primaryAgentId: string | null;
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
  if (!isDefault) return { displayName: tabLabel, Icon, primaryAgentId, agentCliType };

  if (agent)
    return {
      displayName: agent.alias ?? agent.cliType,
      Icon: Terminal,
      primaryAgentId,
      agentCliType,
    };
  if (firstPane?.type === "browser")
    return { displayName: "Browser", Icon: Globe, primaryAgentId, agentCliType };
  if (firstPane?.type === "git")
    return { displayName: "Git", Icon: GitBranch, primaryAgentId, agentCliType };
  if (firstPane?.type === "files")
    return { displayName: "Files", Icon: FolderTree, primaryAgentId, agentCliType };
  if (firstPane?.type === "simulator")
    return { displayName: "Simulator", Icon: Smartphone, primaryAgentId, agentCliType };

  return { displayName: tabLabel, Icon, primaryAgentId, agentCliType };
}
