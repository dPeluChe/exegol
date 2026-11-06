/**
 * Shared protocol between the main process (exegol-server.ts) and the standalone bins
 * (exegol-mcp-shim-bin.ts, exegol-claim-guard-bin.ts).
 * Newline-delimited JSON-RPC 2.0 over a Unix domain socket, mirroring the PTY
 * sidecar's `pty-sidecar-protocol.ts` framing for consistency across the app.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { ipcEndpoint } from "../lib/ipc-endpoint";
import type { ExegolAccessMode } from "./exegol-tool-defs";

export const EXEGOL_DIR = join(homedir(), ".exegol");
export const MCP_SOCK_PATH = ipcEndpoint("mcp-server");

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

export { createFrameReader } from "../lib/frame-reader";

// ─── Exegol tool context — who's calling, and with what access ─────────────

export interface ExegolToolContext {
  agentId: string;
  accessMode: ExegolAccessMode;
  projectId: string;
}

/**
 * The single request shape every exegol tool call carries over the socket.
 * `token` is the per-agent secret minted at spawn (EXEGOL_MCP_TOKEN): the
 * server derives agentId/projectId from its token registry and accessMode
 * from the DB — client-declared identity is never trusted.
 */
export interface ExegolToolCallParams {
  tool: string;
  args: Record<string, unknown>;
  token?: string;
  /** Shim's parent pid — disambiguates agents that share a config file. */
  ppid?: number;
}

/** A tool refusal with its JSON-RPC code, passed to the agent verbatim */
export class ExegolToolError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}

export type { ExegolAccessMode, ExegolToolName } from "./exegol-tool-defs";
