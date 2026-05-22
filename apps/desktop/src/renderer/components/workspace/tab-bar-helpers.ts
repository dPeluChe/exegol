import type { AgentActivityLevel } from "@exegol/shared";
import { FolderTree, GitBranch, Globe, Terminal } from "lucide-react";
import { findFirstPaneId, type LayoutNode, type Pane } from "../../stores/workspace";

// ─── T70: Activity dot for tab chrome ───────────────────────────────────────

export const ACTIVITY_DOT_CLASS: Partial<Record<AgentActivityLevel, string>> = {
  busy: "bg-success animate-status-pulse",
  idle: "bg-warning",
};

// ─── Tab auto-naming helpers ────────────────────────────────────────────────

export const PANE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  browser: Globe,
  files: FolderTree,
  git: GitBranch,
};

/** Derive display name, icon, and primary agent ID from the tab's primary pane */
export function getTabMeta(
  tabLabel: string,
  tabLayout: LayoutNode,
  panes: Record<string, Pane>,
  agents: Record<string, { cliType: string; taskDescription: string }>,
): {
  displayName: string;
  Icon: React.ComponentType<{ className?: string }> | null;
  primaryAgentId: string | null;
} {
  // If user explicitly renamed the tab (not a default name), respect it
  const isDefault =
    tabLabel.startsWith("Tab ") || tabLabel === "Workspace" || tabLabel === "Terminal";

  const firstPaneId = findFirstPaneId(tabLayout);
  const firstPane = firstPaneId ? panes[firstPaneId] : null;
  const Icon = firstPane ? (PANE_TYPE_ICONS[firstPane.type] ?? null) : null;
  const primaryAgentId = firstPane?.type === "terminal" ? (firstPane.agentId ?? null) : null;

  if (!isDefault) return { displayName: tabLabel, Icon, primaryAgentId };

  if (firstPane?.type === "terminal" && firstPane.agentId) {
    const agent = agents[firstPane.agentId];
    if (agent) return { displayName: agent.cliType, Icon: Terminal, primaryAgentId };
  }
  if (firstPane?.type === "browser") return { displayName: "Browser", Icon: Globe, primaryAgentId };
  if (firstPane?.type === "git") return { displayName: "Git", Icon: GitBranch, primaryAgentId };
  if (firstPane?.type === "files")
    return { displayName: "Files", Icon: FolderTree, primaryAgentId };

  return { displayName: tabLabel, Icon, primaryAgentId };
}
