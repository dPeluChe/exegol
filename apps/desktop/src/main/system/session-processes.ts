import type { SessionProcesses, SessionProcessGroup } from "@exegol/shared";
import type { LiveSessionProcess } from "../db/queries/agents";
import type { KnownServer } from "../mcp/claude-servers";
import { CLAIM_GUARD_BIN, SHIM_BIN } from "../mcp/exegol-mcp-config";
import type { ProcRow } from "./process-table";
import { indexProcesses, type ProcIndex, terminalProcesses } from "./process-tree";
import { programTokens } from "./shell-clis";

type Kind = Pick<SessionProcessGroup, "kind" | "name">;

/** Only a program's or a server's name ever leaves main: a command line can carry a token */
function classify(row: ProcRow, shellPid: number, known: KnownServer[]): Kind {
  const [program = "", ...rest] = programTokens(row.args);
  const name = program.replace(/^-/, "") || "process";
  if (row.pid === shellPid) return { kind: "shell", name };
  if (row.args.includes(SHIM_BIN)) return { kind: "bridge", name: "MCP bridge" };
  if (row.args.includes(CLAIM_GUARD_BIN)) return { kind: "bridge", name: "Claim guard" };
  const parts = new Set([program, ...rest, ...row.args.split(/\s+/)]);
  const server = known.find((s) => parts.has(s.hint));
  return server ? { kind: "mcp", name: server.name } : { kind: "other", name };
}

export function sessionProcesses(
  session: Omit<LiveSessionProcess, "projectPath">,
  rows: ProcRow[],
  known: KnownServer[],
  index: ProcIndex = indexProcesses(rows),
): SessionProcesses {
  const self = index.byPid.get(session.pid);
  const all = self ? [self, ...terminalProcesses(session.pid, rows, index)] : [];
  const own = new Map(all.map((r) => [r.pid, r]));
  const kinds = new Map<number, Kind>();
  // `npx pkg` runs the server as its child: what a server or the bridge starts counts with it
  const kindOf = (row: ProcRow): Kind => {
    const seen = kinds.get(row.pid);
    if (seen) return seen;
    let kind = classify(row, session.pid, known);
    const parent = kind.kind === "other" && row.ppid !== row.pid ? own.get(row.ppid) : undefined;
    const above = parent && kindOf(parent);
    if (above && (above.kind === "mcp" || above.kind === "bridge")) kind = above;
    kinds.set(row.pid, kind);
    return kind;
  };
  const groups = new Map<string, SessionProcessGroup>();
  let rssKb = 0;
  let cpu = 0;
  for (const row of all) {
    const { kind, name } = kindOf(row);
    const key = `${kind}:${name}`;
    const g = groups.get(key) ?? { kind, name, count: 0, rssKb: 0 };
    g.count += 1;
    g.rssKb += row.rss ?? 0;
    groups.set(key, g);
    rssKb += row.rss ?? 0;
    cpu += row.cpu ?? 0;
  }
  return {
    agentId: session.id,
    alias: session.alias,
    taskDescription: session.taskDescription,
    cliType: session.cliType,
    projectId: session.projectId,
    projectName: session.projectName,
    count: all.length,
    rssKb,
    cpu: Math.round(cpu * 10) / 10,
    groups: [...groups.values()].sort((a, b) => b.rssKb - a.rssKb),
  };
}
