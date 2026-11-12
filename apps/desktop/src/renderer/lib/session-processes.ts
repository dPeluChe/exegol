import type { SessionProcesses, SessionProcessGroup } from "@exegol/shared";

export interface ProcessTotals {
  sessions: number;
  processes: number;
  rssKb: number;
  mcpProcesses: number;
  mcpRssKb: number;
}

/** A session's MCP side: its servers and Exegol's own bridge */
export function mcpOf(session: SessionProcesses): { count: number; rssKb: number } {
  const out = { count: 0, rssKb: 0 };
  for (const g of session.groups) {
    if (g.kind !== "mcp" && g.kind !== "bridge") continue;
    out.count += g.count;
    out.rssKb += g.rssKb;
  }
  return out;
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
  shell: "shell",
  bridge: "Exegol",
  mcp: "MCP server",
  other: "process",
};
