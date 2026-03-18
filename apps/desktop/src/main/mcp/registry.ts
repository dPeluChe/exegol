/**
 * MCP Server Registry — manages configured MCP servers and discovered tools.
 * Inspired by Zed's ContextServerRegistry and Nanobot's connect_mcp_servers.
 */

export type McpTransport = "stdio" | "http";

export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
};

export type McpTool = {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export type McpServerState = {
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpTool[];
  error?: string;
};
