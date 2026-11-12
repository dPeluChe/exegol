import type { McpAgentState, McpStatusEvent } from "@exegol/shared";
import { hashKey, useQuery } from "@tanstack/react-query";
import { queryClient } from "../lib/query-client";
import { trpcInvoke } from "../lib/trpc-client";

export const MCP_STATUS_KEY = ["agents", "mcpStatus"];

/** Live agents' Exegol MCP state. Pushed on mcp:status (connect, disconnect, spawn, exit), so no
 *  polling: the query runs once and the push keeps it current (agents store) */
export function useMcpStatus(): Record<string, McpAgentState> {
  const { data } = useQuery({
    queryKey: MCP_STATUS_KEY,
    queryFn: () => trpcInvoke<McpStatusEvent>("agents.mcpStatus", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data?.agents ?? {};
}

/** Outside React: one agent's state as last pushed */
export function mcpStateOf(agentId: string): McpAgentState | undefined {
  return queryClient.getQueryData<McpStatusEvent>(MCP_STATUS_KEY)?.agents[agentId];
}

const MCP_STATUS_HASH = hashKey(MCP_STATUS_KEY);

/** Outside React: `onChange` on every new MCP state, nothing else in the cache */
export function onMcpStatusChange(onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.query.queryHash === MCP_STATUS_HASH) onChange();
  });
}
