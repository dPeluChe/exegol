import { ExternalLink } from "lucide-react";
import { type AgentState, jumpToAgent, useAgentStore } from "../../../stores/agents";
import { AgentIcon } from "../../common/AgentIcon";
import { WatchToggle } from "../../common/WatchToggle";
import { ErrorBoundary, paneFallback } from "../../ErrorBoundary";
import { TerminalInstance } from "../../terminal/TerminalInstance";

/** The selected desk. Its body is the session's mirror; the chat view sits beside it */
export function CompanySession({ agent, where }: { agent: AgentState; where: string }) {
  return (
    <aside className="flex w-[430px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AgentIcon provider={agent.cliType} size={16} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-primary">
            {agent.alias ?? agent.cliType}
          </p>
          <p className="truncate text-[10px] text-text-muted">{where}</p>
        </div>
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
      <div
        className="min-h-0 flex-1 overflow-hidden bg-black/40 p-1"
        // Our keys stay on Company until a click: no `data-mirror-agent-id`, Cmd+1 leaves this alone
        onMouseDownCapture={(e) => {
          if (e.button === 2) e.stopPropagation();
        }}
        onFocusCapture={() => useAgentStore.getState().markAttentionRead(agent.id)}
      >
        <ErrorBoundary fallback={paneFallback}>
          <TerminalInstance
            key={`company-${agent.id}`}
            agentId={agent.id}
            cliType={agent.cliType}
            mirror
          />
        </ErrorBoundary>
      </div>
    </aside>
  );
}
