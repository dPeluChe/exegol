import type { SessionProcesses, SessionProcessGroup } from "@exegol/shared";
import { pathBase } from "@exegol/shared";
import type { ProcRow } from "./process-table";
import { terminalProcesses } from "./process-tree";

export interface KnownServer {
  name: string;
  /** Words of its command line that tell it apart: the package or script it runs */
  hints: string[];
}

export interface LiveSession {
  id: string;
  pid: number;
  alias: string | null;
  taskDescription: string | null;
  cliType: string;
  projectId: string;
  projectName: string;
}

const BRIDGE = "exegol-mcp-shim";

function words(args: string): string[] {
  return args.split(/\s+/).filter(Boolean);
}

/** What tells a server's process apart: its last argument that is no flag, else its command */
export function serverHints(command: string, args: string[]): string[] {
  const named = args.filter((a) => !a.startsWith("-") && !a.includes("="));
  const last = named[named.length - 1];
  return last ? [last] : [command];
}

function serverOf(row: ProcRow, known: KnownServer[]): string | null {
  const parts = words(row.args);
  for (const s of known) {
    if (s.hints.length > 0 && s.hints.every((h) => parts.includes(h))) return s.name;
  }
  return null;
}

/** Only the program's name ever leaves main: a command line can carry a token */
function programOf(row: ProcRow): string {
  return pathBase(words(row.args)[0] ?? "").replace(/^-/, "") || "process";
}

function classify(
  row: ProcRow,
  session: LiveSession,
  known: KnownServer[],
): Pick<SessionProcessGroup, "kind" | "name"> {
  if (row.pid === session.pid) return { kind: "shell", name: programOf(row) };
  if (row.args.includes(BRIDGE)) return { kind: "bridge", name: "Exegol bridge" };
  const server = serverOf(row, known);
  if (server) return { kind: "mcp", name: server };
  return { kind: "other", name: programOf(row) };
}

/** The processes of one session grouped by what they are; a server's own children count with it */
export function sessionProcesses(
  session: LiveSession,
  rows: ProcRow[],
  known: KnownServer[],
): SessionProcesses {
  const self = rows.find((r) => r.pid === session.pid);
  const all = self ? [self, ...terminalProcesses(session.pid, rows)] : [];
  const byPid = new Map(all.map((r) => [r.pid, r]));
  const kinds = new Map<number, Pick<SessionProcessGroup, "kind" | "name">>();
  const kindOf = (row: ProcRow): Pick<SessionProcessGroup, "kind" | "name"> => {
    const seen = kinds.get(row.pid);
    if (seen) return seen;
    const own = classify(row, session, known);
    const parent = own.kind === "other" ? byPid.get(row.ppid) : undefined;
    const inherited = parent && parent.pid !== row.pid ? kindOf(parent) : undefined;
    const kind =
      inherited && inherited.kind !== "shell" && inherited.kind !== "other" ? inherited : own;
    kinds.set(row.pid, kind);
    return kind;
  };
  const groups = new Map<string, SessionProcessGroup>();
  for (const row of all) {
    const { kind, name } = kindOf(row);
    const key = `${kind}:${name}`;
    const g = groups.get(key) ?? { kind, name, count: 0, rssKb: 0 };
    g.count += 1;
    g.rssKb += row.rss ?? 0;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.rssKb - a.rssKb);
  return {
    agentId: session.id,
    alias: session.alias,
    taskDescription: session.taskDescription,
    cliType: session.cliType,
    projectId: session.projectId,
    projectName: session.projectName,
    count: all.length,
    rssKb: list.reduce((n, g) => n + g.rssKb, 0),
    cpu: Math.round(all.reduce((n, r) => n + (r.cpu ?? 0), 0) * 10) / 10,
    groups: list,
  };
}
