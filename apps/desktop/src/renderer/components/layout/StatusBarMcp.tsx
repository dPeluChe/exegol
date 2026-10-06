import { cn } from "@exegol/ui";
import { Plug } from "lucide-react";
import { sessionName } from "../../lib/agent-label";
import { useAgentStore } from "../../stores/agents";
import { mcpStateTitle, useMcpStatus } from "../common/McpStatusIndicator";

/** "MCP: 3/4": live agents with the Exegol tools connected; the tooltip says who is not, and what
 *  each one may do with the browser */
export function McpWidget() {
  const states = useMcpStatus();
  const agents = useAgentStore((s) => s.agents);
  const ids = Object.keys(states);
  if (ids.length === 0) return null;
  const connected = ids.filter((id) => states[id] === "connected").length;
  const lines = ids.map((id) => {
    const a = agents[id];
    const state = states[id] ?? "not_wired";
    return `${a ? sessionName(a) : id}: ${mcpStateTitle(state, a?.accessMode)}`;
  });
  return (
    <span
      className={cn("flex shrink-0 items-center gap-1", connected < ids.length && "text-warning")}
      title={lines.join("\n")}
    >
      <Plug className="h-3 w-3" />
      MCP: {connected}/{ids.length}
    </span>
  );
}
