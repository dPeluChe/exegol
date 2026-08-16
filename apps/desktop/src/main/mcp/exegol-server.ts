/**
 * T145 — Exegol MCP Server: a Unix-socket JSON-RPC endpoint running inside
 * the main process, giving spawned agents (via the stdio shim) mid-session
 * access to memory_search / memory_save / knowledge_get. Shells never talk
 * to this (no `.mcp.json` is written for shell-type agents — see
 * agent-spawn-flow.ts).
 *
 * Security model: identity comes from a per-agent secret token minted at
 * spawn (EXEGOL_MCP_TOKEN). The server maps token → {agentId, projectId} in
 * its own registry and re-reads the agent's access mode from the DB on every
 * call — nothing the client claims about itself is trusted. Any local process
 * without a live token gets -32002 on every call.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { findBlockingClaim } from "../db/queries/path-claims";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import {
  createNdjsonBuffer,
  EXEGOL_DIR,
  type ExegolAccessMode,
  type ExegolToolCallParams,
  type ExegolToolContext,
  encodeResponse,
  getToolDefsForAccessMode,
  type JsonRpcRequest,
  MCP_SOCK_PATH,
} from "./exegol-protocol";
import { callExegolTool, ExegolToolError } from "./exegol-tools";

let server: Server | null = null;

// ─── Token registry ──────────────────────────────────────────────────────────

interface TokenEntry {
  agentId: string;
  projectId: string;
}

// A token may bind MORE THAN ONE agent: providers whose MCP config is
// per-DIRECTORY (opencode, gemini, devin, agy) share one file, so two sessions
// in the same repo present the same secret. Refusing the second binding left
// that agent permanently unauthorized; picking one silently made `self` flip
// between them mid-session (Juanito, 2026-08-13: "self.name = paco … minutos
// después estaba invertido"). We keep every binding and disambiguate below —
// and when we cannot, we say so instead of guessing.
const tokensBySecret = new Map<string, TokenEntry[]>();
const tokensByAgent = new Map<string, string>();

function bindToken(token: string, entry: TokenEntry): void {
  // Rebinding to a different secret must release the old one, or the stale
  // entry keeps the agent resolvable through a token it no longer uses.
  const previous = tokensByAgent.get(entry.agentId);
  if (previous && previous !== token) {
    const rest = (tokensBySecret.get(previous) ?? []).filter((e) => e.agentId !== entry.agentId);
    if (rest.length === 0) tokensBySecret.delete(previous);
    else tokensBySecret.set(previous, rest);
  }
  const entries = tokensBySecret.get(token) ?? [];
  if (!entries.some((e) => e.agentId === entry.agentId)) entries.push(entry);
  tokensBySecret.set(token, entries);
  tokensByAgent.set(entry.agentId, token);
}

/** Mint (or reuse) the MCP token for an agent at spawn time. */
export function registerAgentMcpToken(agentId: string, projectId: string): string {
  const existing = tokensByAgent.get(agentId);
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  bindToken(token, { agentId, projectId });
  return token;
}

/** Re-arm an EXISTING token after app restart (registry is in-memory only).
 *  The reattached agent's shim/.mcp.json still hold the old secret — minting
 *  a new one would orphan them; restoring keeps identity continuous. */
export function restoreAgentMcpToken(agentId: string, projectId: string, token: string): void {
  bindToken(token, { agentId, projectId });
}

/** Revoke on agent exit — a leaked .mcp.json must not stay a live credential. */
export function revokeAgentMcpToken(agentId: string): void {
  const token = tokensByAgent.get(agentId);
  if (token) {
    // Drop only THIS agent's binding: a shared token must keep working for the
    // siblings still alive.
    const rest = (tokensBySecret.get(token) ?? []).filter((e) => e.agentId !== agentId);
    if (rest.length === 0) tokensBySecret.delete(token);
    else tokensBySecret.set(token, rest);
  }
  tokensByAgent.delete(agentId);
}

/** One `ps` hop. The shim is usually a direct child of the CLI (hop 0 needs no
 *  `ps` at all), but some CLIs interpose a wrapper — walking a couple of levels
 *  finds the PTY process anyway. Kept short: this blocks the main process. */
function parentOf(pid: number): number | null {
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

/**
 * T166: which agent is this shim? The token authenticates, but providers whose
 * MCP config is per-DIRECTORY (opencode, gemini, devin, agy) share one file, so
 * two sessions in the same repo — a legitimate setup: same code, different
 * models — present the same token.
 *
 * The OS knows better. Interactive CLIs are `exec`d, so the PTY process IS the
 * CLI, and the shim it spawns descends from it. It is a DISAMBIGUATOR, never a
 * credential: a caller still needs a token we minted, and a pid match only
 * counts inside that token's own project.
 */
/** The shim's ancestry never changes, so walk it ONCE per connection. Without
 *  the cache an unresolvable token re-forked `ps` on every single call, forever,
 *  blocking the main process that also drives PTY output and the UI. */
/**
 * The claim guard is a FRESH PROCESS per write, so it opens a fresh connection
 * and the per-connection ancestor cache never hits — every Edit would fork up
 * to four blocking `ps` calls on the process that also pumps every PTY. The
 * mapping cannot change within a session, so memoize it by caller instead.
 */
const IDENTITY_TTL_MS = 30_000;
const identityMemo = new Map<string, { chain: number[]; at: number }>();

function ancestorPids(conn: McpConnectionState | undefined, ppid: number | undefined): number[] {
  if (conn?.ancestors) return conn.ancestors;
  const memoKey = ppid === undefined ? null : String(ppid);
  if (memoKey) {
    const hit = identityMemo.get(memoKey);
    if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) {
      if (conn) conn.ancestors = hit.chain;
      return hit.chain;
    }
  }
  const chain: number[] = [];
  let pid: number | null = ppid ?? null;
  while (pid !== null && chain.length < PID_WALK_MAX_HOPS) {
    chain.push(pid);
    pid = chain.length < PID_WALK_MAX_HOPS ? parentOf(pid) : null;
  }
  if (conn) conn.ancestors = chain;
  if (memoKey) identityMemo.set(memoKey, { chain, at: Date.now() });
  return chain;
}

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
      accessMode:
        row.access_mode === "write" || row.access_mode === "plan" ? row.access_mode : "read",
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
    // A token whose agent is gone must not authorize anything, even if the
    // secret is still on disk somewhere (leaked config, committed file).
    if (!row || !LIVE_STATUSES.has(row.status as AgentStatus)) return null;
    return row.access_mode === "write" || row.access_mode === "plan" ? row.access_mode : "read";
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to read agent access mode (defaulting to read):", err);
    return "read";
  }
}

/**
 * Per-connection identity. Each CLI runs its own shim process, hence its own
 * socket — so once we know who is on the other end, that answer holds for the
 * connection's life. Without this pin, resolution re-raced on every call and an
 * agent saw its own name and id change between two consecutive `agents_list`
 * calls, which is how a reply came back addressed to the sender itself.
 */
export interface McpConnectionState {
  pinnedAgentId?: string;
  /** Cached `ps` walk — the shim's ancestry is fixed for the connection. */
  ancestors?: number[];
}

type Resolution =
  | { ok: true; context: ExegolToolContext }
  | { ok: false; code: number; message: string };

function resolveContext(
  db: Database.Database,
  token: string | undefined,
  ppid?: number,
  conn?: McpConnectionState,
): Resolution {
  if (!token) {
    return { ok: false, code: -32002, message: "Unauthorized: no EXEGOL_MCP_TOKEN sent" };
  }
  const bound = tokensBySecret.get(token);
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

  // Keep the access mode the liveness check already computed — re-reading it
  // downstream was a second query for a row we just looked at.
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

  // The OS knows which session actually spawned this shim. Interactive CLIs are
  // `exec`d, so the PTY process IS the CLI and the shim descends from it. This
  // is a DISAMBIGUATOR, never a credential — a valid token is still required,
  // and we only accept a pid match inside the token's own project.
  //
  // Deliberately BEFORE the single-binding shortcut: when a sibling overwrites a
  // shared config file, the surviving session presents the sibling's token, so
  // `live` is legitimately length 1 and only the process tree gives the right
  // answer. Skipping the walk here would reintroduce the identity swap.
  const byPid = resolveByParentPid(db, ancestorPids(conn, ppid), [
    ...new Set(live.map((e) => e.projectId)),
  ]);
  if (byPid) {
    if (conn) conn.pinnedAgentId = byPid.agentId;
    if (!live.some((e) => e.agentId === byPid.agentId)) {
      logger.info(
        `[ExegolMcp] Caller's process tree belongs to ${byPid.agentId}, which is not the token's own binding — trusting the process tree (shared config file)`,
      );
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

  // Several live sessions share this token and the process tree didn't settle
  // it. Guessing here is what swapped two agents' identities — refuse instead.
  return {
    ok: false,
    code: -32003,
    message:
      `Ambiguous identity: ${live.length} live sessions share this MCP config file ` +
      `(${live.map((e) => e.agentId).join(", ")}) and Exegol could not tell which one is calling. ` +
      "Ask the user to give one of them its own worktree, or use a CLI that supports per-session MCP config.",
  };
}

// ─── Activity log (T163) ─────────────────────────────────────────────────────
//
// The ring buffer is ALWAYS on: it's capped, in-memory, and it's the only way
// to see what agents are actually doing over the socket (Settings > MCP Server
// > Activity). Backend-log lines are opt-in (`mcpVerboseLogging`) so a chatty
// fleet doesn't drown the app log.

export type McpActivityKind = "connect" | "disconnect" | "call" | "error";

export interface McpActivityEntry {
  at: number;
  kind: McpActivityKind;
  tool?: string;
  agentId?: string;
  ms?: number;
  detail?: string;
}

const MAX_ACTIVITY = 100;
const activity: McpActivityEntry[] = [];
let verboseLogging = false;
let connectionSeq = 0;

export function setMcpVerboseLogging(enabled: boolean): void {
  if (verboseLogging === enabled) return;
  verboseLogging = enabled;
  logger.info(`[ExegolMcp] Verbose logging ${enabled ? "ENABLED" : "disabled"}`);
}

function record(entry: Omit<McpActivityEntry, "at">): void {
  activity.push({ ...entry, at: Date.now() });
  if (activity.length > MAX_ACTIVITY) activity.shift();
  if (!verboseLogging) return;
  const who = entry.agentId ? ` agent=${entry.agentId}` : "";
  const took = entry.ms !== undefined ? ` (${entry.ms}ms)` : "";
  const what = entry.tool ? ` ${entry.tool}` : "";
  const detail = entry.detail ? ` — ${entry.detail}` : "";
  const line = `[ExegolMcp] ${entry.kind}${what}${who}${took}${detail}`;
  if (entry.kind === "error") logger.warn(line);
  else logger.info(line);
}

export function getRecentMcpActivity(): McpActivityEntry[] {
  return [...activity].reverse();
}

// ─── Request handling ────────────────────────────────────────────────────────

export async function handleRequest(
  db: Database.Database,
  socket: Socket,
  req: JsonRpcRequest,
  conn?: McpConnectionState,
): Promise<void> {
  // T163 stale-shim fix: shims proxy tools/list here so tool definitions are
  // always the RUNNING app's — a shim spawned weeks ago still lists new tools.
  if (req.method === "list_tools") {
    const params = req.params as { token?: string; ppid?: number } | undefined;
    const resolved = resolveContext(db, params?.token, params?.ppid, conn);
    record({
      kind: "call",
      tool: "tools/list",
      agentId: resolved.ok ? resolved.context.agentId : undefined,
      detail: resolved.ok ? undefined : "no valid identity (listing read-mode tools)",
    });
    socket.write(
      encodeResponse(req.id, {
        tools: getToolDefsForAccessMode(resolved.ok ? resolved.context.accessMode : "read"),
      }),
    );
    return;
  }
  // T175: enforcement, not audit. A shared working tree gives git no way to
  // attribute a change to an agent, so a violation can only be caught BEFORE
  // the write — which is exactly what a PreToolUse hook is. Identity comes from
  // the same token the shim uses, so an agent cannot ask on someone's behalf.
  if (req.method === "check_path") {
    const params = req.params as { token?: string; ppid?: number; path?: string };
    const resolved = resolveContext(db, params.token, params.ppid, conn);
    if (!resolved.ok || !params.path) {
      // Fail-open must be COUNTED. A silent allow is indistinguishable from a
      // real one, so a session that lost enforcement looks identical to one
      // that never needed it.
      record({ kind: "error", tool: "check_path", detail: "unidentified caller — allowed" });
      // Fail OPEN: a guard that blocks when it cannot identify the caller would
      // stop an agent from working over an app restart or a revoked token.
      socket.write(encodeResponse(req.id, { allowed: true }));
      return;
    }
    const { agentId, projectId } = resolved.context;
    let holder: { heldBy: string; note: string | null } | null = null;
    try {
      holder = findBlockingClaim(db, { agentId, projectId, path: params.path });
    } catch (err) {
      logger.warn("[ExegolMcp] check_path failed (allowing):", err);
    }
    // Only blocks are recorded: the activity ring holds 100 entries, and one
    // agent doing a hundred edits would evict every message and memory call
    // from the panel whose purpose is showing what agents are doing.
    if (holder) {
      record({
        kind: "error",
        tool: "check_path",
        agentId,
        detail: `blocked ${params.path} — held by ${holder.heldBy}`,
      });
      // The model is told by the guard; the USER has to hear it somewhere too,
      // or a collision is only ever visible in a ring buffer that evicts it.
      try {
        getNotificationBus().emit({
          type: "agent:attention",
          title: "Write blocked — file claimed by another agent",
          body: `${params.path} is held by "${holder.heldBy}"`,
          agentId,
          projectId,
          at: Date.now(),
        });
      } catch {
        /* notifications are best-effort */
      }
    }
    socket.write(encodeResponse(req.id, { allowed: !holder, ...holder }));
    return;
  }

  if (req.method !== "call_tool") {
    record({ kind: "error", detail: `unknown method: ${req.method}` });
    socket.write(
      encodeResponse(req.id, undefined, { code: -32601, message: `Unknown method: ${req.method}` }),
    );
    return;
  }

  const params = req.params as ExegolToolCallParams;
  const resolved = resolveContext(db, params.token, params.ppid, conn);
  if (!resolved.ok) {
    record({ kind: "error", tool: params.tool, detail: resolved.message });
    socket.write(
      encodeResponse(req.id, undefined, { code: resolved.code, message: resolved.message }),
    );
    return;
  }
  const context = resolved.context;

  const startedAt = Date.now();
  try {
    const result = await callExegolTool(db, params.tool, params.args, context);
    record({
      kind: "call",
      tool: params.tool,
      agentId: context.agentId,
      ms: Date.now() - startedAt,
    });
    socket.write(encodeResponse(req.id, result));
  } catch (err) {
    const code = err instanceof ExegolToolError ? err.code : -32000;
    const message = err instanceof Error ? err.message : String(err);
    record({
      kind: "error",
      tool: params.tool,
      agentId: context.agentId,
      ms: Date.now() - startedAt,
      detail: `${code}: ${message}`,
    });
    socket.write(encodeResponse(req.id, undefined, { code, message }));
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function startListening(db: Database.Database): void {
  const srv = createServer((socket: Socket) => {
    // Connection churn is the diagnostic that matters: a shim that never
    // reconnects after an app restart shows up here as silence.
    const connId = ++connectionSeq;
    const conn: McpConnectionState = {};
    // Announced lazily: the claim guard opens a fresh connection per write, and
    // announcing those would evict every real agent call from a 100-entry ring.
    let announced = false;
    const feed = createNdjsonBuffer<JsonRpcRequest>((msg) => {
      if (!announced && msg.method !== "check_path") {
        announced = true;
        record({ kind: "connect", detail: `shim #${connId}` });
      }
      handleRequest(db, socket, msg, conn).catch((err) => {
        record({ kind: "error", detail: `unhandled: ${err instanceof Error ? err.message : err}` });
        logger.warn("[ExegolMcp] Unhandled request error:", err);
      });
    });
    socket.on("data", feed);
    socket.on("close", () => {
      if (announced) record({ kind: "disconnect", detail: `shim #${connId}` });
    });
    socket.on("error", () => {
      /* client disconnects are routine — nothing to clean up per-connection */
    });
  });

  srv.on("error", (err) => {
    logger.warn("[ExegolMcp] Server error:", err);
    server = null; // allow a later ensure() to retry
  });

  srv.listen(MCP_SOCK_PATH, () => {
    try {
      chmodSync(MCP_SOCK_PATH, 0o600);
    } catch (err) {
      logger.warn("[ExegolMcp] Failed to chmod socket:", err);
    }
    logger.info(`[ExegolMcp] Listening on ${MCP_SOCK_PATH}`);
  });

  server = srv;
}

/** Start the socket server if not already running. Safe to call repeatedly. */
export function ensureExegolMcpServerStarted(db: Database.Database): void {
  if (server) return;

  mkdirSync(EXEGOL_DIR, { recursive: true, mode: 0o700 });

  if (!existsSync(MCP_SOCK_PATH)) {
    startListening(db);
    return;
  }

  // A socket file exists: probe before unlinking. A second Exegol instance
  // must not hijack the first one's LIVE socket (all shims would silently
  // reroute to us with tokens we never minted).
  const probe = connect(MCP_SOCK_PATH);
  const settle = (stale: boolean) => {
    probe.destroy();
    if (!stale) {
      logger.warn(
        "[ExegolMcp] Another live instance owns the MCP socket — not starting a second server",
      );
      return;
    }
    try {
      unlinkSync(MCP_SOCK_PATH);
    } catch (err) {
      logger.warn("[ExegolMcp] Failed to clear stale socket:", err);
    }
    startListening(db);
  };
  probe.once("connect", () => settle(false));
  probe.once("error", () => settle(true));
}

/** T162 settings surface: live server state + how many tokens are armed. */
export function getExegolMcpServerInfo(): {
  running: boolean;
  sockPath: string;
  activeTokens: number;
} {
  return { running: server !== null, sockPath: MCP_SOCK_PATH, activeTokens: tokensByAgent.size };
}

export function stopExegolMcpServer(): void {
  server?.close();
  server = null;
  tokensBySecret.clear();
  tokensByAgent.clear();
  try {
    if (existsSync(MCP_SOCK_PATH)) unlinkSync(MCP_SOCK_PATH);
  } catch {
    /* best-effort */
  }
}
