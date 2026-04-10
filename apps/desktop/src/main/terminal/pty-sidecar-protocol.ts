// Shared protocol between main process and PTY sidecar.
// Uses newline-delimited JSON-RPC 2.0 over Unix domain socket.

import { homedir } from "node:os";
import { join } from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────

export const EXEGOL_DIR = join(homedir(), ".exegol");
export const SIDECAR_SOCK_PATH = join(EXEGOL_DIR, "pty-sidecar.sock");
export const SIDECAR_PID_PATH = join(EXEGOL_DIR, "pty-sidecar.pid");
export const SIDECAR_VERSION = "1.0.0";

// ─── Timeouts ───────────────────────────────────────────────────────────

export const SIDECAR_CONNECT_TIMEOUT_MS = 5_000;
export const SIDECAR_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // Auto-exit after 5min idle
export const RING_BUFFER_CAPACITY = 8 * 1024 * 1024; // 8MB per session

// ─── PID file ───────────────────────────────────────────────────────────

export interface PidFile {
  pid: number;
  token: string;
  version: string;
  sock: string;
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────

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

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ─── Method params & results ────────────────────────────────────────────

export interface SessionCreateParams {
  id: string;
  shell: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
}

export interface SessionCreateResult {
  pid: number;
}

export interface SessionWriteParams {
  id: string;
  data: string;
}

export interface SessionResizeParams {
  id: string;
  cols: number;
  rows: number;
}

export interface SessionIdParams {
  id: string;
}

export interface SessionSnapshotResult {
  data: string | null;
}

export interface SessionListResult {
  sessions: string[];
}

/**
 * Richer session listing that distinguishes live PTYs from exited-but-still-buffered
 * sessions (inside the sidecar's 60s grace period for scrollback retrieval).
 * Used by startup recovery so dead sessions aren't re-marked as running.
 */
export interface SessionInfo {
  id: string;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
}

export interface SessionListInfoResult {
  sessions: SessionInfo[];
}

export interface PingResult {
  version: string;
  uptime: number;
  sessions: number;
}

// ─── Notification params (sidecar → main) ───────────────────────────────

export interface SessionDataNotification {
  id: string;
  data: string;
}

export interface SessionExitNotification {
  id: string;
  exitCode: number;
  signal?: number;
}

export interface SessionErrorNotification {
  id: string;
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

let nextId = 1;

export function makeRequest(method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })}\n`;
}

export function makeNotification(method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
}

export function makeResponse(
  id: number,
  result?: unknown,
  error?: { code: number; message: string },
): string {
  if (error) return `${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`;
  return `${JSON.stringify({ jsonrpc: "2.0", id, result: result ?? null })}\n`;
}
