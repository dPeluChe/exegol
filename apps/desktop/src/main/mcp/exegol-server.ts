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

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
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

const tokensBySecret = new Map<string, TokenEntry>();
const tokensByAgent = new Map<string, string>();

/** Mint (or reuse) the MCP token for an agent at spawn time. */
export function registerAgentMcpToken(agentId: string, projectId: string): string {
  const existing = tokensByAgent.get(agentId);
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  tokensBySecret.set(token, { agentId, projectId });
  tokensByAgent.set(agentId, token);
  return token;
}

/** Re-arm an EXISTING token after app restart (registry is in-memory only).
 *  The reattached agent's shim/.mcp.json still hold the old secret — minting
 *  a new one would orphan them; restoring keeps identity continuous. */
export function restoreAgentMcpToken(agentId: string, projectId: string, token: string): boolean {
  // Two agents sharing a cwd read the SAME token file; binding it twice would
  // let one impersonate the other (and one exit would revoke both).
  const owner = tokensBySecret.get(token);
  if (owner && owner.agentId !== agentId) {
    logger.warn(
      `[ExegolMcp] Refusing to re-arm a token already bound to ${owner.agentId} for ${agentId} — both agents share a cwd; give one a worktree`,
    );
    return false;
  }
  tokensBySecret.set(token, { agentId, projectId });
  tokensByAgent.set(agentId, token);
  return true;
}

/** Revoke on agent exit — a leaked .mcp.json must not stay a live credential. */
export function revokeAgentMcpToken(agentId: string): void {
  const token = tokensByAgent.get(agentId);
  // Only drop the secret if it still maps to THIS agent — otherwise a shared
  // token would kill a live sibling's MCP access.
  if (token && tokensBySecret.get(token)?.agentId === agentId) tokensBySecret.delete(token);
  tokensByAgent.delete(agentId);
}

function resolveContext(
  db: Database.Database,
  token: string | undefined,
): ExegolToolContext | null {
  if (!token) return null;
  const entry = tokensBySecret.get(token);
  if (!entry) return null;

  // Access mode is re-read from the DB per call (T58 source of truth) —
  // fail-closed to "read" when the row is missing or the column is unset.
  let accessMode: ExegolAccessMode = "read";
  try {
    const row = db
      .prepare("SELECT access_mode, status FROM agents WHERE id = ?")
      .get(entry.agentId) as { access_mode?: string; status?: string } | undefined;
    // A token whose agent is gone must not authorize anything, even if the
    // secret is still on disk somewhere (leaked config, committed file).
    if (!row || !LIVE_STATUSES.has(row.status as AgentStatus)) return null;
    if (row.access_mode === "write" || row.access_mode === "plan") {
      accessMode = row.access_mode;
    }
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to read agent access mode (defaulting to read):", err);
  }

  return { agentId: entry.agentId, projectId: entry.projectId, accessMode };
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
): Promise<void> {
  // T163 stale-shim fix: shims proxy tools/list here so tool definitions are
  // always the RUNNING app's — a shim spawned weeks ago still lists new tools.
  if (req.method === "list_tools") {
    const params = req.params as { token?: string } | undefined;
    const context = resolveContext(db, params?.token);
    record({
      kind: "call",
      tool: "tools/list",
      agentId: context?.agentId,
      detail: context ? undefined : "no valid token (listing read-mode tools)",
    });
    socket.write(
      encodeResponse(req.id, { tools: getToolDefsForAccessMode(context?.accessMode ?? "read") }),
    );
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
  const context = resolveContext(db, params.token);
  if (!context) {
    record({
      kind: "error",
      tool: params.tool,
      detail: params.token
        ? "unauthorized: token not in registry (agent exited, or app restarted without re-arming)"
        : "unauthorized: no token sent by the shim",
    });
    socket.write(
      encodeResponse(req.id, undefined, {
        code: -32002,
        message: "Unauthorized: missing or revoked EXEGOL_MCP_TOKEN",
      }),
    );
    return;
  }

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
    record({ kind: "connect", detail: `shim #${connId}` });
    const feed = createNdjsonBuffer<JsonRpcRequest>((msg) => {
      handleRequest(db, socket, msg).catch((err) => {
        record({ kind: "error", detail: `unhandled: ${err instanceof Error ? err.message : err}` });
        logger.warn("[ExegolMcp] Unhandled request error:", err);
      });
    });
    socket.on("data", feed);
    socket.on("close", () => record({ kind: "disconnect", detail: `shim #${connId}` }));
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
