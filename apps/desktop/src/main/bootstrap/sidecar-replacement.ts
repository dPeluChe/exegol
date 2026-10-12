// What a sidecar version bump ended: before discovery shuts the old sidecar down, an inventory of
// its live sessions goes to ~/.exegol/sidecar-replaced-<timestamp>.json (ids and DB metadata only:
// no output, no env), and recovery names why each agent came back crashed.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "libsql";
import { logger } from "../lib/logger";
import type { SidecarReplacement } from "../terminal/pty-sidecar-discovery";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";

export interface AgentRow {
  id: string;
  project_id: string | null;
  cli_type: string | null;
  alias: string | null;
  pid: number | null;
  status: string | null;
}

export interface ReplacedInventory {
  replacedAt: string;
  from: string;
  to: string;
  sessions: Array<{
    agentId: string;
    projectId: string | null;
    cliType: string | null;
    alias: string | null;
    pid: number | null;
    status: string | null;
  }>;
}

/** Pure: one entry per live session; a session with no agent row keeps only its id */
export function buildReplacedInventory(
  r: SidecarReplacement,
  rows: AgentRow[],
  at: Date,
): ReplacedInventory {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    replacedAt: at.toISOString(),
    from: r.from,
    to: r.to,
    sessions: r.liveSessionIds.map((id) => {
      const row = byId.get(id);
      return {
        agentId: id,
        projectId: row?.project_id ?? null,
        cliType: row?.cli_type ?? null,
        alias: row?.alias ?? null,
        pid: row?.pid ?? null,
        status: row?.status ?? null,
      };
    }),
  };
}

export function inventoryFileName(at: Date): string {
  return `sidecar-replaced-${at.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** Writes the inventory; returns the path as logged (`~/.exegol/...`), or null on failure */
export function writeReplacedInventory(
  db: Database.Database,
  r: SidecarReplacement,
): string | null {
  const at = new Date();
  const ids = r.liveSessionIds;
  const rows =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, project_id, cli_type, alias, pid, status FROM agents WHERE id IN (${ids
              .map(() => "?")
              .join(",")})`,
          )
          .all(...ids) as AgentRow[]);
  const name = inventoryFileName(at);
  try {
    writeFileSync(
      join(EXEGOL_DIR, name),
      `${JSON.stringify(buildReplacedInventory(r, rows, at), null, 2)}\n`,
    );
  } catch (err) {
    logger.warn("[Sidecar] could not write the replacement inventory:", err);
    return null;
  }
  const shown = `~/.exegol/${name}`;
  logger.info(`[Sidecar] inventory of ${ids.length} replaced session(s): ${shown}`);
  return shown;
}

export interface CrashContext {
  /** Live in the sidecar a version bump replaced */
  replaced: Set<string>;
  dead: Set<string>;
  failed: Set<string>;
  sidecarConnected: boolean;
  /** -1: unknown */
  sidecarSessionTotal: number;
}

/** Pure: why recovery marks this agent crashed */
export function crashReason(id: string, c: CrashContext): string {
  if (c.replaced.has(id)) return "sidecar replaced (version bump)";
  if (c.dead.has(id)) return "PTY had exited in the sidecar";
  if (c.failed.has(id)) return "reattach failed";
  if (!c.sidecarConnected) return "sidecar unavailable";
  if (c.sidecarSessionTotal === 0) return "sidecar came back empty (restart, reboot or kill)";
  return "no session in the sidecar";
}

/** Pure: "reason=count, ..." for the summary line */
export function countReasons(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([r, n]) => `${r}: ${n}`).join(", ");
}
