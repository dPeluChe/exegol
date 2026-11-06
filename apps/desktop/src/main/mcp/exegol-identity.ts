import { execFileSync } from "node:child_process";
import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { readProcessTable } from "../system/process-table";
import type { ExegolAccessMode, ExegolToolContext } from "./exegol-protocol";
import { boundAgents, type McpConnectionState, type TokenEntry } from "./exegol-tokens";

/** One `ps` hop; some CLIs interpose a wrapper. Short timeout: this blocks the main process */
function parentOf(pid: number): number | null {
  // Windows has no ps and PowerShell would block here: `primeAncestors` read the table first
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf-8",
      timeout: 500,
    });
    const parsed = Number.parseInt(out.trim(), 10);
    return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
  } catch {
    return null;
  }
}

const PID_WALK_MAX_HOPS = 4;
const TABLE_MAX_AGE_MS = 5_000;

/**
 * Which session a shim belongs to, when sessions share a token: the shim descends from its CLI,
 * the PTY process. A disambiguator, never a credential: a minted token is still required and a pid
 * only counts inside that token's project.
 */
function ancestorPids(conn: McpConnectionState | undefined, ppid: number | undefined): number[] {
  if (conn?.ancestors) return conn.ancestors;
  const chain: number[] = [];
  let pid: number | null = ppid ?? null;
  while (pid !== null && chain.length < PID_WALK_MAX_HOPS) {
    chain.push(pid);
    pid = chain.length < PID_WALK_MAX_HOPS ? parentOf(pid) : null;
  }
  if (conn) conn.ancestors = chain;
  return chain;
}

/** A PTY's PowerShell sits above the CLI, and the walk needs a process table Windows reads in a
 *  second or two: read off the main thread, once per connection */
export async function primeAncestors(
  conn: McpConnectionState | undefined,
  ppid: number | undefined,
): Promise<void> {
  if (process.platform !== "win32" || !conn || conn.ancestors || ppid === undefined) return;
  const rows = await readProcessTable({ maxAgeMs: TABLE_MAX_AGE_MS }).catch(() => []);
  conn.ancestors = ancestorChain(ppid, new Map(rows.map((r) => [r.pid, r.ppid])));
}

export function ancestorChain(ppid: number, parents: Map<number, number>): number[] {
  const chain = [ppid];
  while (chain.length < PID_WALK_MAX_HOPS) {
    const parent = parents.get(chain.at(-1) as number);
    if (!parent) break;
    chain.push(parent);
  }
  return chain;
}

/** Anything unknown is read: this gates write tools, so it never fails open */
const toAccessMode = (raw: string | undefined): ExegolAccessMode =>
  raw === "write" || raw === "plan" ? raw : "read";

function resolveByParentPid(
  db: Database.Database,
  ancestors: number[],
  projectIds: string[],
): { agentId: string; projectId: string; accessMode: ExegolAccessMode } | null {
  if (ancestors.length === 0 || projectIds.length === 0) return null;
  const statuses = [...LIVE_STATUSES];
  try {
    const row = db
      .prepare(
        `SELECT id, project_id, access_mode FROM agents
         WHERE pid IN (${ancestors.map(() => "?").join(",")})
           AND project_id IN (${projectIds.map(() => "?").join(",")})
           AND status IN (${statuses.map(() => "?").join(",")})
         LIMIT 1`,
      )
      .get(...ancestors, ...projectIds, ...statuses) as
      | { id: string; project_id: string; access_mode?: string }
      | undefined;
    if (!row) return null;
    return {
      agentId: row.id,
      projectId: row.project_id,
      accessMode: toAccessMode(row.access_mode),
    };
  } catch {
    return null;
  }
}

function readLiveAccessMode(db: Database.Database, agentId: string): ExegolAccessMode | null {
  try {
    const row = db.prepare("SELECT access_mode, status FROM agents WHERE id = ?").get(agentId) as
      | { access_mode?: string; status?: string }
      | undefined;
    // A token whose agent is gone authorizes nothing, even if still on disk
    if (!row || !LIVE_STATUSES.has(row.status as AgentStatus)) return null;
    return toAccessMode(row.access_mode);
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to read agent access mode (defaulting to read):", err);
    return "read";
  }
}

type Resolution =
  | { ok: true; context: ExegolToolContext }
  | { ok: false; code: number; message: string };

export function resolveContext(
  db: Database.Database,
  token: string | undefined,
  ppid?: number,
  conn?: McpConnectionState,
): Resolution {
  if (!token) {
    return { ok: false, code: -32002, message: "Unauthorized: no EXEGOL_MCP_TOKEN sent" };
  }
  const bound = boundAgents(token);
  if (!bound?.length) {
    return {
      ok: false,
      code: -32002,
      message: "Unauthorized: missing or revoked EXEGOL_MCP_TOKEN",
    };
  }

  // Sticky first: a pinned identity only expires when that agent stops being live.
  if (conn?.pinnedAgentId) {
    const entry = bound.find((e) => e.agentId === conn.pinnedAgentId);
    const accessMode = entry ? readLiveAccessMode(db, entry.agentId) : null;
    if (entry && accessMode) {
      return {
        ok: true,
        context: { agentId: entry.agentId, projectId: entry.projectId, accessMode },
      };
    }
    conn.pinnedAgentId = undefined;
  }

  const live = bound
    .map((e) => ({ ...e, accessMode: readLiveAccessMode(db, e.agentId) }))
    .filter((e): e is TokenEntry & { accessMode: ExegolAccessMode } => e.accessMode !== null);
  if (live.length === 0) {
    return {
      ok: false,
      code: -32002,
      message: "Unauthorized: this token's session is no longer running",
    };
  }

  // Before the single-binding shortcut: a sibling that overwrote a shared config makes `live`
  // length 1 with the wrong session, and only the process tree gives the right answer.
  const byPid = resolveByParentPid(db, ancestorPids(conn, ppid), [
    ...new Set(live.map((e) => e.projectId)),
  ]);
  if (byPid) {
    if (conn) conn.pinnedAgentId = byPid.agentId;
    const ownBinding = live.some((e) => e.agentId === byPid.agentId);
    if (!ownBinding) {
      // `ppid` comes from the caller: identity follows the tree, but access is capped at what its
      // own token grants, or a plan-mode agent could name a write-mode pid and inherit write.
      const tokenMayWrite = live.some((e) => e.accessMode === "write");
      const capped: ExegolAccessMode =
        byPid.accessMode === "write" && !tokenMayWrite ? "read" : byPid.accessMode;
      logger.info(
        `[ExegolMcp] Caller's process tree belongs to ${byPid.agentId}, not a binding of this token — trusting the tree for identity, capping access at ${capped} (shared config file)`,
      );
      return { ok: true, context: { ...byPid, accessMode: capped } };
    }
    return { ok: true, context: byPid };
  }

  const only = live[0];
  if (live.length === 1 && only) {
    if (conn) conn.pinnedAgentId = only.agentId;
    return {
      ok: true,
      context: { agentId: only.agentId, projectId: only.projectId, accessMode: only.accessMode },
    };
  }

  // Guessing here is what swapped two agents' identities: refuse
  return {
    ok: false,
    code: -32003,
    message:
      `Ambiguous identity: ${live.length} live sessions share this MCP config file ` +
      `(${live.map((e) => e.agentId).join(", ")}) and Exegol could not tell which one is calling. ` +
      "Ask the user to give one of them its own worktree, or use a CLI that supports per-session MCP config.",
  };
}
