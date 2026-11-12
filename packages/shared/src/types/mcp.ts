export type McpTransport = "stdio" | "http";

/** One of the person's MCP servers in Claude Code's config: never its command, env or headers */
export interface ClaudeMcpServerInfo {
  name: string;
  /** user: every project; local: this folder, private; project: the repo's .mcp.json */
  scope: "user" | "local" | "project";
  /** stdio starts a process per session */
  transport: McpTransport | "sse" | "ws";
}

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
