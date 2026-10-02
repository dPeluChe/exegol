import { cn } from "@exegol/ui";
import { Globe, LayoutGrid } from "lucide-react";
import { focusPane, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { collectPaneIds, type Pane, useWorkspaceStore } from "../../stores/workspace";
import { PANE_TYPE_ICONS } from "../workspace/tab-bar-helpers";
import { AgentMiniCard } from "./AgentMiniCard";

const PANE_LABEL: Record<string, string> = {
  files: "Files",
  git: "Git",
  empty: "Launcher",
  terminal: "Terminal",
};

function hostOf(url: string | undefined): string {
  if (!url) return "Browser";
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/** Selects its own agent: a status push re-renders this row, not the whole tree */
function PaneAgentRow({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  return agent ? <AgentMiniCard agent={agent} /> : null;
}

/** One row per pane, in layout order: agents and shells as agent rows, the rest by what they show */
function PaneRow({ pane, onOpen }: { pane: Pane; onOpen: () => void }) {
  if (pane.type === "terminal" && pane.agentId) return <PaneAgentRow agentId={pane.agentId} />;
  const Icon = pane.type === "empty" ? LayoutGrid : (PANE_TYPE_ICONS[pane.type] ?? Globe);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[10px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
    >
      <Icon className="ml-0.5 h-3 w-3 shrink-0" />
      <span className="truncate">
        {pane.type === "browser" ? hostOf(pane.url) : PANE_LABEL[pane.type]}
      </span>
    </button>
  );
}

/**
 * The project's workspace as it is laid out: each tab with the panes it holds.
 * The sidebar listed agents by branch and then the same tabs again, so a tab
 * with a CLI, a shell and a browser showed its agents twice under two names.
 */
export function TabsOverview({ projectId }: { projectId: string }) {
  const pw = useWorkspaceStore((s) => s.projectWorkspaces[projectId]);
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const tabs = pw?.tabs ?? [];
  if (tabs.length === 0) return null;

  return (
    <div className="space-y-1">
      {tabs.map((tab, i) => {
        const isActive = activeProjectId === projectId && tab.id === pw?.activeTabId;
        return (
          <div key={tab.id}>
            <button
              type="button"
              onClick={() => focusPane(projectId, tab.id)}
              className={cn(
                "flex w-full items-center gap-1.5 px-1 py-0.5 text-left text-[9px] font-medium uppercase tracking-wider",
                isActive ? "text-text-secondary" : "text-text-muted hover:text-text-secondary",
              )}
            >
              <span
                className={cn(
                  "h-1 w-1 shrink-0 rounded-full",
                  isActive ? "bg-accent" : "bg-text-muted/40",
                )}
              />
              <span className="truncate">{tab.label || `Tab ${i + 1}`}</span>
            </button>
            <div className="space-y-px">
              {collectPaneIds(tab.layout).map((paneId) => {
                const pane = pw?.panes[paneId];
                if (!pane) return null;
                return (
                  <PaneRow
                    key={paneId}
                    pane={pane}
                    onOpen={() => focusPane(projectId, tab.id, paneId)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
