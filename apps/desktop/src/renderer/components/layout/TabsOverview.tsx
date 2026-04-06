import type { AgentStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { FolderTree, GitBranch, Globe, Layout } from "lucide-react";
import type { ComponentType } from "react";
import { useAgentStore } from "../../stores/agents";
import {
  collectPaneIds,
  findFirstPaneId,
  type Pane,
  selectActiveTabId,
  selectPanes,
  selectTabs,
  useWorkspaceStore,
  type WorkspaceTab,
} from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import { StatusDot } from "../common/StatusDot";

const PANE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  browser: Globe,
  files: FolderTree,
  git: GitBranch,
  empty: Layout,
};

function PaneDot({
  pane,
  agents,
}: {
  pane: Pane | undefined;
  agents: Record<string, { cliType: string; status: string }>;
}) {
  if (!pane) return null;
  // Terminal panes with agents show the agent icon
  if (pane.type === "terminal" && pane.agentId) {
    const agent = agents[pane.agentId];
    if (agent) {
      return (
        <span title={agent.cliType} className="flex items-center justify-center">
          <AgentIcon provider={agent.cliType} size={12} />
        </span>
      );
    }
  }
  const Icon = PANE_ICON[pane.type] ?? Layout;
  return (
    <span title={pane.type} className="flex items-center justify-center">
      <Icon className="h-2.5 w-2.5 text-text-muted" />
    </span>
  );
}

function TabRow({ tab, isActive }: { tab: WorkspaceTab; isActive: boolean }) {
  const panes = useWorkspaceStore(selectPanes);
  const agents = useAgentStore((s) => s.agents);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);

  const paneIds = collectPaneIds(tab.layout);
  const firstPaneId = findFirstPaneId(tab.layout);
  const firstPane = firstPaneId ? panes[firstPaneId] : null;

  // Derive tab name and icon from primary pane
  let name = tab.label;
  let agentForIcon: { cliType: string; status: string } | null = null;
  if (firstPane?.type === "terminal" && firstPane.agentId) {
    const agent = agents[firstPane.agentId];
    if (agent) {
      name = agent.cliType;
      agentForIcon = agent;
    }
  } else if (firstPane?.type === "browser") name = "Browser";
  else if (firstPane?.type === "git") name = "Git";
  else if (firstPane?.type === "files") name = "Files";

  return (
    <button
      type="button"
      onClick={() => setActiveTab(tab.id)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[10px] transition-colors",
        isActive ? "bg-white/10 text-text-primary" : "text-text-muted hover:bg-white/5",
      )}
    >
      {agentForIcon ? (
        <>
          <AgentIcon provider={agentForIcon.cliType} size={14} />
          <StatusDot status={agentForIcon.status as AgentStatus} size="sm" />
        </>
      ) : (
        (() => {
          const Icon = PANE_ICON[firstPane?.type ?? "empty"] ?? Layout;
          return <Icon className="h-3 w-3 shrink-0 text-text-muted" />;
        })()
      )}
      <span className="flex-1 truncate">{name}</span>
      {paneIds.length > 1 && (
        <span className="flex items-center gap-0.5">
          {paneIds.map((pid) => (
            <PaneDot key={pid} pane={panes[pid]} agents={agents} />
          ))}
        </span>
      )}
    </button>
  );
}

export function TabsOverview() {
  const tabs = useWorkspaceStore(selectTabs);
  const panes = useWorkspaceStore(selectPanes);
  const activeTabId = useWorkspaceStore(selectActiveTabId);

  if (tabs.length === 0) return null;

  // Only show tabs that have multiple panes or non-agent panes.
  // Single-agent-terminal tabs are already visible in the agents list above.
  const interestingTabs = tabs.filter((tab) => {
    const paneIds = collectPaneIds(tab.layout);
    if (paneIds.length > 1) return true;
    const firstPaneId = paneIds[0];
    const pane = firstPaneId ? panes[firstPaneId] : null;
    if (!pane) return true;
    // Hide single-pane terminal tabs (agent already shown above)
    if (pane.type === "terminal" && pane.agentId) return false;
    return true;
  });

  if (interestingTabs.length === 0) return null;

  return (
    <div className="mt-1 space-y-px">
      <div className="flex items-center gap-1 pb-0.5 text-[9px] font-medium uppercase tracking-wider text-text-muted">
        <Layout className="h-2.5 w-2.5" />
        <span>Tabs ({interestingTabs.length})</span>
      </div>
      {interestingTabs.map((tab) => (
        <TabRow key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
}
