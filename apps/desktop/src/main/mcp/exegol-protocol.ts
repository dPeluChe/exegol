/**
 * T145 — Shared protocol between the main process (exegol-server.ts) and the
 * standalone shim binaries (exegol-mcp-shim-bin.ts, exegol-ctl-bin.ts).
 * Newline-delimited JSON-RPC 2.0 over a Unix domain socket, mirroring the PTY
 * sidecar's `pty-sidecar-protocol.ts` framing for consistency across the app.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const EXEGOL_DIR = join(homedir(), ".exegol");
export const MCP_SOCK_PATH = join(EXEGOL_DIR, "mcp-server.sock");

// ─── JSON-RPC 2.0 (socket side — NDJSON framed) ─────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export function encodeRequest(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export function encodeResponse(
  id: number,
  result?: unknown,
  error?: { code: number; message: string },
): string {
  if (error) return `${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`;
  return `${JSON.stringify({ jsonrpc: "2.0", id, result: result ?? null })}\n`;
}

/**
 * Buffers arbitrary chunks and yields complete newline-delimited JSON messages.
 * Shared by the server and both bin scripts so socket framing stays in one place.
 */
export function createNdjsonBuffer<T>(onMessage: (msg: T) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf-8");
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.trim().length > 0) {
        try {
          onMessage(JSON.parse(line) as T);
        } catch {
          // Malformed line — drop it, don't crash the connection.
        }
      }
      newlineIdx = buffer.indexOf("\n");
    }
  };
}

// ─── Exegol tool context — who's calling, and with what access ─────────────

export type ExegolAccessMode = "read" | "plan" | "write";

export interface ExegolToolContext {
  agentId: string;
  accessMode: ExegolAccessMode;
  projectId: string;
}

/** The single request shape every exegol tool call carries over the socket. */
export interface ExegolToolCallParams {
  tool: string;
  args: Record<string, unknown>;
  context: ExegolToolContext;
}
