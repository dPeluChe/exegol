import { cn } from "@exegol/ui";
import { LayoutGrid, Rows3 } from "lucide-react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { sessionName } from "../../lib/agent-label";
import { pageLabel } from "../../lib/browser-viewports";
import type { SwitcherItem } from "../../lib/pane-switcher";
import {
  installPaneSwitcherKeys,
  selectSwitcherItem,
  usePaneSwitcherView,
} from "../../lib/pane-switcher-control";
import { STATUS_DOT_COLORS } from "../../lib/semantic-colors";
import { useAgentStore } from "../../stores/agents";
import { type Pane, selectPanes, selectTabs, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import { PANE_TYPE_ICONS, tabLabel } from "./tab-bar-helpers";

const PANE_LABEL: Record<string, string> = {
  git: "Git",
  empty: "Launcher",
  terminal: "Terminal",
  simulator: "Simulator",
};

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function AgentPaneLabel({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  if (!agent) return <span className="truncate">Terminal</span>;
  return (
    <>
      <AgentIcon provider={agent.cliType} size={14} />
      <span className="truncate">{sessionName(agent)}</span>
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          STATUS_DOT_COLORS[agent.status] ?? "bg-zinc-500",
        )}
      />
    </>
  );
}

function PaneLabel({ pane }: { pane: Pane }) {
  if (pane.type === "terminal" && pane.agentId) return <AgentPaneLabel agentId={pane.agentId} />;
  const Icon = pane.type === "empty" ? LayoutGrid : (PANE_TYPE_ICONS[pane.type] ?? LayoutGrid);
  const path = pane.openFile ?? pane.filePath;
  const label =
    pane.type === "browser"
      ? pageLabel(pane.url) || "Browser"
      : pane.type === "files"
        ? path
          ? baseName(path)
          : "Files"
        : PANE_LABEL[pane.type];
  return (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="truncate" title={pane.type === "files" ? path : undefined}>
        {label}
      </span>
    </>
  );
}

function Row({
  item,
  index,
  highlighted,
  isCurrent,
  label,
  pane,
}: {
  item: SwitcherItem;
  index: number;
  highlighted: boolean;
  isCurrent: boolean;
  label: string;
  pane: Pane | undefined;
}) {
  return (
    <button
      type="button"
      ref={(el) => {
        if (highlighted) el?.scrollIntoView({ block: "nearest" });
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => selectSwitcherItem(index)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px]",
        item.kind === "tab"
          ? "mt-1 font-medium uppercase tracking-wider text-[10px] text-text-secondary first:mt-0"
          : "pl-6 text-text-secondary",
        highlighted ? "bg-accent/20 text-text-primary" : "hover:bg-white/5",
      )}
    >
      {item.kind === "tab" ? (
        <>
          <Rows3 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate">{label}</span>
        </>
      ) : pane ? (
        <PaneLabel pane={pane} />
      ) : null}
      {isCurrent && (
        <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-accent">
          current
        </span>
      )}
    </button>
  );
}

type SwitcherView = NonNullable<ReturnType<typeof usePaneSwitcherView.getState>["view"]>;

function SwitcherOverlay({ view }: { view: SwitcherView }) {
  const tabs = useWorkspaceStore(selectTabs);
  const panes = useWorkspaceStore(selectPanes);
  const labelOf = (tabId: string) => {
    const at = tabs.findIndex((t) => t.id === tabId);
    const tab = tabs[at];
    return tab ? tabLabel(tab, at) : "";
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[210] flex items-center justify-center">
      <div className="pointer-events-auto flex max-h-[70vh] w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-border bg-bg-primary p-2 shadow-2xl">
        <div className="min-h-0 overflow-y-auto">
          {view.items.map((item, i) => (
            <Row
              key={`${item.kind}:${item.paneId}:${item.tabId}`}
              item={item}
              index={i}
              highlighted={i === view.index}
              isCurrent={item.kind === "pane" && item.paneId === view.current}
              label={labelOf(item.tabId)}
              pane={panes[item.paneId]}
            />
          ))}
        </div>
        <div className="mt-1 border-t border-border px-2 pt-1.5 text-[10px] text-text-muted">
          Tab / Shift+Tab to move, release Ctrl to go, Esc cancels
        </div>
      </div>
    </div>
  );
}

/** Ctrl+Tab held: the project's tabs (most recent first) and their panes */
export function PaneSwitcher() {
  useMountEffect(installPaneSwitcherKeys);
  const view = usePaneSwitcherView((s) => s.view);
  return view ? <SwitcherOverlay view={view} /> : null;
}
