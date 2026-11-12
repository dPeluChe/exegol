import type { SessionProcesses, SessionProcessGroup } from "@exegol/shared";

export interface ProcessTotals {
  sessions: number;
  processes: number;
  rssKb: number;
  mcpProcesses: number;
  mcpRssKb: number;
}

const isMcp = (g: SessionProcessGroup) => g.kind === "mcp" || g.kind === "bridge";

export function mcpOf(session: SessionProcesses): { count: number; rssKb: number } {
  const groups = session.groups.filter(isMcp);
  return {
    count: groups.reduce((n, g) => n + g.count, 0),
    rssKb: groups.reduce((n, g) => n + g.rssKb, 0),
  };
}

export function processTotals(list: SessionProcesses[]): ProcessTotals {
  const totals = { sessions: list.length, processes: 0, rssKb: 0, mcpProcesses: 0, mcpRssKb: 0 };
  for (const s of list) {
    const mcp = mcpOf(s);
    totals.processes += s.count;
    totals.rssKb += s.rssKb;
    totals.mcpProcesses += mcp.count;
    totals.mcpRssKb += mcp.rssKb;
  }
  return totals;
}

export const GROUP_LABEL: Record<SessionProcessGroup["kind"], string> = {
  shell: "Shell",
  bridge: "Exegol",
  mcp: "MCP server",
  other: "Process",
};
