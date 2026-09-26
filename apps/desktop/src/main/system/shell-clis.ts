import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { getProviderRegistry } from "../agents/registry";

const execFileAsync = promisify(execFile);

export interface ProcRow {
  pid: number;
  ppid: number;
  args: string;
}

/** Interpreters whose script (the next token) names the CLI: `node .../codex` */
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3"]);

function cliNames(args: string): string[] {
  const [first = "", second = ""] = args.trim().split(/\s+/);
  const base = (t: string) => t.split("/").pop() ?? "";
  return RUNTIMES.has(base(first)) ? [base(second)] : [base(first)];
}

/** For each shell, the first CLI (by provider command) running anywhere below it */
export function matchShellClis(
  shells: { id: string; pid: number }[],
  rows: ProcRow[],
  commandToProvider: Map<string, string>,
): Record<string, string> {
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r]);
  const found: Record<string, string> = {};
  for (const shell of shells) {
    let level = children.get(shell.pid) ?? [];
    for (let depth = 0; depth < 6 && level.length > 0 && !found[shell.id]; depth++) {
      for (const r of level) {
        const provider = cliNames(r.args)
          .map((n) => commandToProvider.get(n))
          .find(Boolean);
        if (provider) {
          found[shell.id] = provider;
          break;
        }
      }
      level = level.flatMap((r) => children.get(r.pid) ?? []);
    }
  }
  return found;
}

/**
 * Agent CLIs started by hand inside a plain terminal (`claude` typed in a shell pane):
 * the pane stayed "Terminal". One `ps` for all live shells, only while there are any.
 */
export async function detectShellClis(db: Database.Database): Promise<Record<string, string>> {
  const statuses = [...LIVE_STATUSES];
  const shells = db
    .prepare(
      `SELECT id, pid FROM agents WHERE cli_type = 'shell' AND pid IS NOT NULL
       AND status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(...statuses) as { id: string; pid: number }[];
  if (shells.length === 0) return {};

  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,args="], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] ?? "" });
  }
  const commands = new Map(
    getProviderRegistry()
      .list()
      .filter((p) => p.id !== "shell" && p.command && !p.command.startsWith("__"))
      .map((p) => [p.command, p.id]),
  );
  return matchShellClis(shells, rows, commands);
}
