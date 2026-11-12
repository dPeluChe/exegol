export type MetricsSnapshot = {
  cpu: number;
  memoryPercent: number;
  diskPercent: number;
  timestamp: number;
};

export interface SessionProcessGroup {
  kind: "shell" | "bridge" | "mcp" | "other";
  /** A program's name or an MCP server's name, never a command line */
  name: string;
  count: number;
  /** Resident memory in KB: shared pages are counted in every process that maps them */
  rssKb: number;
}

export interface SessionProcesses {
  agentId: string;
  alias: string | null;
  taskDescription: string | null;
  cliType: string;
  projectId: string;
  projectName: string;
  count: number;
  rssKb: number;
  cpu: number;
  groups: SessionProcessGroup[];
}
