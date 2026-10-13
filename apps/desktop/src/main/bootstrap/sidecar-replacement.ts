// A version bump ends every live session: the inventory says which ones (ids and DB metadata,
// never output or env), and crashReason says why each agent came back crashed.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "@exegol/shared";
import type Database from "libsql";
import { listAgentsByIds } from "../db/queries/agents";
import { logger } from "../lib/logger";
import type { SidecarReplacement } from "../terminal/pty-sidecar-discovery";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";

type InventoryAgent = Pick<Agent, "id" | "projectId" | "cliType" | "alias" | "pid" | "status">;

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
  agents: InventoryAgent[],
  at: Date,
): ReplacedInventory {
  const byId = new Map(agents.map((a) => [a.id, a]));
  return {
    replacedAt: at.toISOString(),
    from: r.from,
    to: r.to,
    sessions: r.liveSessionIds.map((id) => {
      const a = byId.get(id);
      return {
        agentId: id,
        projectId: a?.projectId ?? null,
        cliType: a?.cliType ?? null,
        alias: a?.alias ?? null,
        pid: a?.pid ?? null,
        status: a?.status ?? null,
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
  const agents = listAgentsByIds(db, ids);
  const name = inventoryFileName(at);
  try {
    writeFileSync(
      join(EXEGOL_DIR, name),
      `${JSON.stringify(buildReplacedInventory(r, agents, at), null, 2)}\n`,
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
