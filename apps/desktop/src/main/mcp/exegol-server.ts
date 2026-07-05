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
import type Database from "libsql";
import { logger } from "../lib/logger";
import {
  createNdjsonBuffer,
  EXEGOL_DIR,
  type ExegolAccessMode,
  type ExegolToolCallParams,
  type ExegolToolContext,
  encodeResponse,
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

/** Revoke on agent exit — a leaked .mcp.json must not stay a live credential. */
export function revokeAgentMcpToken(agentId: string): void {
  const token = tokensByAgent.get(agentId);
  if (token) tokensBySecret.delete(token);
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
    const row = db.prepare("SELECT access_mode FROM agents WHERE id = ?").get(entry.agentId) as
      | { access_mode?: string }
      | undefined;
    if (row?.access_mode === "write" || row?.access_mode === "plan") {
      accessMode = row.access_mode;
    }
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to read agent access mode (defaulting to read):", err);
  }

  return { agentId: entry.agentId, projectId: entry.projectId, accessMode };
}

// ─── Request handling ────────────────────────────────────────────────────────

async function handleRequest(
  db: Database.Database,
  socket: Socket,
  req: JsonRpcRequest,
): Promise<void> {
  if (req.method !== "call_tool") {
    socket.write(
      encodeResponse(req.id, undefined, { code: -32601, message: `Unknown method: ${req.method}` }),
    );
    return;
  }

  const params = req.params as ExegolToolCallParams;
  const context = resolveContext(db, params.token);
  if (!context) {
    socket.write(
      encodeResponse(req.id, undefined, {
        code: -32002,
        message: "Unauthorized: missing or revoked EXEGOL_MCP_TOKEN",
      }),
    );
    return;
  }

  try {
    const result = await callExegolTool(db, params.tool, params.args, context);
    socket.write(encodeResponse(req.id, result));
  } catch (err) {
    const code = err instanceof ExegolToolError ? err.code : -32000;
    const message = err instanceof Error ? err.message : String(err);
    socket.write(encodeResponse(req.id, undefined, { code, message }));
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function startListening(db: Database.Database): void {
  const srv = createServer((socket: Socket) => {
    const feed = createNdjsonBuffer<JsonRpcRequest>((msg) => {
      handleRequest(db, socket, msg).catch((err) => {
        logger.warn("[ExegolMcp] Unhandled request error:", err);
      });
    });
    socket.on("data", feed);
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
