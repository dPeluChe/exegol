// Shared protocol between main process and PTY sidecar.
// Uses newline-delimited JSON-RPC 2.0 over Unix domain socket.

import { homedir } from "node:os";
import { join } from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────

export const EXEGOL_DIR = join(homedir(), ".exegol");
export const SIDECAR_SOCK_PATH = join(EXEGOL_DIR, "pty-sidecar.sock");
export const SIDECAR_PID_PATH = join(EXEGOL_DIR, "pty-sidecar.pid");
// Bumped to 1.2.0 when session.memory + per-session bufferCapacity were added.
// Older running sidecars are auto-upgraded by main/index.ts on startup when safe.
export const SIDECAR_VERSION = "1.2.0";
export const SIDECAR_MIN_COMPATIBLE_VERSION = "1.1.0";

// ─── Timeouts ───────────────────────────────────────────────────────────

export const SIDECAR_CONNECT_TIMEOUT_MS = 5_000;
export const SIDECAR_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // Auto-exit after 5min idle
export const RING_BUFFER_CAPACITY = 8 * 1024 * 1024; // 8MB per session (default)
export const SHELL_RING_BUFFER_CAPACITY = 1 * 1024 * 1024; // 1MB for plain shells (T143)

// ─── Ring buffer memory policy (T143) ────────────────────────────────────

/** Global cap across all sessions' pre-allocated ring buffer capacity. */
export const GLOBAL_RING_BUFFER_CAP_BYTES = 256 * 1024 * 1024; // 256MB
/** A session is eviction-eligible once idle (no PTY output) for this long. */
export const RING_BUFFER_EVICTION_IDLE_MS = 2 * 60 * 1000; // 2 minutes
/** How often the sidecar checks whether it's over the global cap. */
export const RING_BUFFER_EVICTION_SWEEP_MS = 60 * 1000; // 1 minute

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
  /** T143: override the default 8MB ring buffer (e.g. smaller for plain shells) */
  bufferCapacity?: number;
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

/** Per-session ring buffer memory usage (T143 — Monitor > Resources). */
export interface SessionMemoryInfo {
  id: string;
  /** Pre-allocated ring buffer capacity in bytes */
  capacityBytes: number;
  /** Bytes currently coalesced, not yet flushed to the renderer */
  pendingBytes: number;
  /** True if this session's ring buffer was evicted to disk (idle, over the global cap) */
  evicted: boolean;
}

export interface SessionMemoryResult {
  sessions: SessionMemoryInfo[];
  totalCapacityBytes: number;
  globalCapBytes: number;
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
