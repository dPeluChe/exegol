import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { type AgentState, jumpToAgent, useAgentStore } from "../../../stores/agents";
import { type CompanyView, useAppStore } from "../../../stores/app";
import { AgentIcon } from "../../common/AgentIcon";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { SessionAlias } from "../../common/SessionAlias";
import { WatchToggle } from "../../common/WatchToggle";
import { ErrorBoundary, paneFallback } from "../../ErrorBoundary";
import { MirrorFrame } from "../../terminal/MirrorFrame";
import { CompanyChat } from "./CompanyChat";

const VIEWS: { id: CompanyView; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "terminal", label: "Terminal" },
];
const PANEL_ID = "company-session-panel";

/** The selected desk: its turns as a chat, or its mirror. A plain shell has no turns */
export function CompanySession({
  agent,
  where,
  picked,
  onPick,
}: {
  agent: AgentState;
  where: string;
  picked: CompanyView;
  onPick: (view: CompanyView) => void;
}) {
  const side = useAppStore((s) => s.companySessionSide);
  const toggleSide = useAppStore((s) => s.toggleCompanySessionSide);
  const hasChat = agent.cliType !== "shell";
  const view = hasChat ? picked : "terminal";
  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AgentIcon provider={agent.cliType} size={16} />
        <div className="min-w-0 flex-1">
          <SessionAlias agent={agent} textClassName="text-xs font-medium" />
          <p className="truncate text-[10px] text-text-muted">{where}</p>
        </div>
        <button
          type="button"
          onClick={toggleSide}
          title={`Move to the ${side === "left" ? "right" : "left"}`}
          className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
        >
          <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
        </button>
        <WatchToggle agentId={agent.id} className="text-[10px]" />
        <button
          type="button"
          onClick={() => jumpToAgent(agent.id, agent.projectId)}
          className="flex shrink-0 items-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover"
        >
          <ExternalLink className="h-3 w-3" />
          Open in its layout
        </button>
      </div>
      {hasChat && (
        <div className="border-b border-border p-1.5">
          <SegmentedTabs
            tabs={VIEWS}
            active={view}
            onChange={onPick}
            compact
            label="Session view"
            panelId={PANEL_ID}
          />
        </div>
      )}
      {view === "chat" ? (
        <div id={PANEL_ID} role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary fallback={paneFallback}>
            <CompanyChat agent={agent} where={where} onTerminal={() => onPick("terminal")} />
          </ErrorBoundary>
        </div>
      ) : (
        <MirrorFrame
          agent={agent}
          id={PANEL_ID}
          role={hasChat ? "tabpanel" : undefined}
          className="min-h-0 flex-1 overflow-hidden bg-black/40 p-1"
          onFocusCapture={() => useAgentStore.getState().markAttentionRead(agent.id)}
        />
      )}
    </aside>
  );
}
