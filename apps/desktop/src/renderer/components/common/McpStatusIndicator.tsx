import type { AgentAccessMode, McpAgentState } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plug } from "lucide-react";
import { useMcpStatus } from "../../hooks/use-mcp-status";

/** What the agent can do with the browser pane, by access mode */
function browserToolsLabel(mode: AgentAccessMode | null | undefined): string {
  return mode === "write"
    ? "browser tools: full (navigate, click, type)"
    : "browser tools: look only (list, open, snapshot, screenshot, logs)";
}

export function mcpStateTitle(state: McpAgentState, mode: AgentAccessMode | null | undefined) {
  if (state === "connected") return `Exegol tools connected; ${browserToolsLabel(mode)}`;
  if (state === "not_connected") {
    return "Exegol tools not connected: the CLI has not started its exegol MCP server yet (check its /mcp)";
  }
  return "Exegol tools are not wired for this session (no MCP config was written for it)";
}

/** Small plug: green when the agent's MCP shim is connected, muted when not */
export function McpStatusIndicator({
  agentId,
  accessMode,
  className,
}: {
  agentId: string;
  accessMode?: AgentAccessMode | null;
  className?: string;
}) {
  const state = useMcpStatus()[agentId];
  if (!state) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center",
        state === "connected" ? "text-success" : "text-text-muted/50",
        className,
      )}
      title={mcpStateTitle(state, accessMode)}
      role="img"
      aria-label={mcpStateTitle(state, accessMode)}
    >
      <Plug className="h-2.5 w-2.5" />
    </span>
  );
}
