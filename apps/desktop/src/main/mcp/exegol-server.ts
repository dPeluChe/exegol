/**
 * T145 — Exegol MCP Server: a Unix-socket JSON-RPC endpoint running inside
 * the main process, giving spawned agents (via the stdio shim) mid-session
 * access to memory_search / memory_save / knowledge_get. Shells never talk
 * to this (no `.mcp.json` is written for shell-type agents — see
 * agent-spawn-flow.ts).
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import type Database from "libsql";
import { logger } from "../lib/logger";
import {
  createNdjsonBuffer,
  encodeResponse,
  EXEGOL_DIR,
  type ExegolToolCallParams,
  type JsonRpcRequest,
  MCP_SOCK_PATH,
} from "./exegol-protocol";
import { callExegolTool, ExegolToolError } from "./exegol-tools";

let server: Server | null = null;

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

  try {
    const params = req.params as ExegolToolCallParams;
    const result = await callExegolTool(db, params.tool, params.args, params.context);
    socket.write(encodeResponse(req.id, result));
  } catch (err) {
    const code = err instanceof ExegolToolError ? err.code : -32000;
    const message = err instanceof Error ? err.message : String(err);
    socket.write(encodeResponse(req.id, undefined, { code, message }));
  }
}

/** Start the socket server if not already running. Safe to call repeatedly. */
export function ensureExegolMcpServerStarted(db: Database.Database): void {
  if (server) return;

  mkdirSync(EXEGOL_DIR, { recursive: true });
  if (existsSync(MCP_SOCK_PATH)) {
    try {
      unlinkSync(MCP_SOCK_PATH);
    } catch (err) {
      logger.warn("[ExegolMcp] Failed to clear stale socket:", err);
    }
  }

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
  });

  srv.listen(MCP_SOCK_PATH, () => {
    logger.info(`[ExegolMcp] Listening on ${MCP_SOCK_PATH}`);
  });

  server = srv;
}

export function stopExegolMcpServer(): void {
  server?.close();
  server = null;
}
