/**
 * T145 — Exegol MCP shim: a standalone process spawned by the agent CLI as
 * its "exegol" MCP server (registered via `.mcp.json`, see exegol-mcp-config.ts).
 * Speaks proper MCP-over-stdio (Content-Length framed JSON-RPC, mirroring
 * host.ts's StdioTransport) to the CLI, and forwards `tools/call` over the
 * NDJSON Unix socket to the main process (exegol-server.ts). Runs via
 * `ELECTRON_RUN_AS_NODE=1` — same pattern as pty-sidecar-entry.ts.
 *
 * All diagnostics go to stderr; stdout is reserved for the framed protocol.
 */

import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import {
  createNdjsonBuffer,
  type ExegolAccessMode,
  encodeRequest,
  getToolDefsForAccessMode,
  type JsonRpcResponse,
  MCP_SOCK_PATH,
} from "./exegol-protocol";

// Identity is the token — the server maps it to agent/project and re-reads
// access mode from the DB. The env mode below only shapes tools/list display;
// it fails CLOSED to "read" (enforcement is server-side regardless).
//
// Order matters, and it is the whole identity fix: EXEGOL_MCP_TOKEN is set on
// the CLI's PTY at spawn and inherited down to us, so it is per SESSION.
// EXEGOL_MCP_TOKEN_FILE comes from a config file that every session in the
// directory shares — using it when a per-session token exists is what made two
// agents present the same identity. Disk is the last resort, for CLIs that
// sanitize the env they hand to MCP servers (codex).
function resolveToken(): string {
  const perSession = process.env.EXEGOL_MCP_TOKEN;
  if (perSession) return perSession;
  const fromConfigEnv = process.env.EXEGOL_MCP_TOKEN_FILE;
  if (fromConfigEnv) return fromConfigEnv;
  try {
    const raw = readFileSync(join(process.cwd(), ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: {
        exegol?: { env?: { EXEGOL_MCP_TOKEN_FILE?: string; EXEGOL_MCP_TOKEN?: string } };
      };
    };
    const env = parsed.mcpServers?.exegol?.env;
    return env?.EXEGOL_MCP_TOKEN_FILE ?? env?.EXEGOL_MCP_TOKEN ?? "";
  } catch {
    return "";
  }
}

let token = resolveToken();
if (!token) {
  process.stderr.write(
    `[exegol-mcp-shim] no EXEGOL_MCP_TOKEN in env or ${join(process.cwd(), ".mcp.json")} — calls will be unauthorized\n`,
  );
}
const displayMode = (process.env.EXEGOL_ACCESS_MODE as ExegolAccessMode) ?? "read";

// ─── stdio framing ──────────────────────────────────────────────────────────
// MCP-over-stdio is newline-delimited JSON (what Claude Code and every spec
// client sends). The original shim spoke Content-Length/LSP framing, so
// clients hung forever on "connecting". Auto-detect per message and reply in
// whichever framing the client used (framed kept for host.ts-style clients).

// The buffer is BYTES, not a string: Content-Length counts bytes while a JS
// string indexes UTF-16 units, so any non-ASCII body (español, emoji) made the
// old string-sliced version cut mid-frame, desync, and silently flip the
// client to the wrong framing forever.
let stdinBuffer = Buffer.alloc(0);
const HEADER_SEP = Buffer.from("\r\n\r\n");

process.stdin.on("data", (chunk: Buffer) => {
  stdinBuffer = stdinBuffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([stdinBuffer, chunk]);
  processStdinBuffer();
});
// The shim is the CLI's child: when the CLI goes away, so do we. Without this
// the socket handle keeps the loop alive and orphans pile up across sessions.
process.stdin.on("end", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));

function processStdinBuffer(): void {
  for (;;) {
    // Skip leading whitespace/newlines between frames.
    let start = 0;
    while (start < stdinBuffer.length && stdinBuffer[start] !== undefined) {
      const b = stdinBuffer[start] as number;
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) start++;
      else break;
    }
    if (start > 0) stdinBuffer = stdinBuffer.subarray(start);
    if (stdinBuffer.length === 0) return;

    // Header detection is case-insensitive: LSP allows `content-length:` and
    // other headers before it.
    const headerEnd = stdinBuffer.indexOf(HEADER_SEP);
    const maybeHeader =
      headerEnd === -1 ? null : stdinBuffer.subarray(0, headerEnd).toString("latin1").toLowerCase();
    if (maybeHeader?.includes("content-length:")) {
      const match = maybeHeader.match(/content-length:\s*(\d+)/);
      const contentLength = Number.parseInt(match?.[1] ?? "0", 10);
      const contentStart = headerEnd + HEADER_SEP.length;
      if (stdinBuffer.length < contentStart + contentLength) return; // wait for the rest
      const content = stdinBuffer.subarray(contentStart, contentStart + contentLength).toString();
      stdinBuffer = stdinBuffer.subarray(contentStart + contentLength);
      dispatchRaw(content, true);
      continue;
    }

    const nl = stdinBuffer.indexOf(0x0a);
    if (nl === -1) return;
    const line = stdinBuffer.subarray(0, nl).toString().trim();
    stdinBuffer = stdinBuffer.subarray(nl + 1);
    if (line.length === 0) continue;
    dispatchRaw(line, false);
  }
}

function dispatchRaw(content: string, framed: boolean): void {
  try {
    handleClientMessage(JSON.parse(content), framed);
  } catch (err) {
    process.stderr.write(`[exegol-mcp-shim] failed to parse client message: ${err}\n`);
  }
}

function writeToClient(
  id: number | string,
  // Captured per REQUEST: async replies (a 30s tool call) must not inherit the
  // framing of whatever message happened to arrive meanwhile.
  framed: boolean,
  result?: unknown,
  error?: { code: number; message: string },
): void {
  const body = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result: result ?? null };
  const msg = JSON.stringify(body);
  if (framed) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, "utf-8")}\r\n\r\n${msg}`);
  } else {
    process.stdout.write(`${msg}\n`);
  }
}

// ─── Unix socket connection to the main process ────────────────────────────

let nextSocketId = 1;
interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** Did this request actually reach the socket? Decides whether a failure
   *  means "never ran" or "unknown" — see callSocket. */
  sent: boolean;
  /** What the agent can do about an ambiguous outcome. Per-tool, because the
   *  transport has no business knowing agent_send's idempotency protocol. */
  recoveryHint: string;
}

/** Only agent_send can be replayed safely today (it takes an idempotency key
 *  and exposes message_status); everything else gets no false promise. */
function recoveryHintFor(tool: string): string {
  return tool === "agent_send"
    ? " Check message_status, or retry with the same message_id — identical keys are never delivered twice."
    : " Verify the outcome before retrying.";
}
const pending = new Map<number, PendingCall>();
const CALL_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
// Deliberately well under CALL_TIMEOUT_MS: at a 30s ceiling the first call after
// an outage could time out before the socket even retried.
const RECONNECT_MAX_MS = 5_000;
const MAX_OUTBOX = 64;

// The shim outlives app restarts (it's the CLI's child). A one-shot socket left
// every call timing out after a restart until the user ran /mcp — live incident
// 2026-08-12. Reconnect with exponential backoff; calls made while down wait in
// the outbox (keyed by id) and flush on reconnect — but only if still pending,
// so a call that already timed out is NOT silently re-executed on reconnect.
let socket: ReturnType<typeof connect> | null = null;
let reconnectScheduled = false;
let reconnectDelay = RECONNECT_BASE_MS;
let loggedThisOutage = false;
const outbox: Array<{ id: number; payload: string }> = [];

function rejectAllPending(): void {
  for (const [id, waiter] of pending) {
    pending.delete(id);
    waiter.reject(
      new Error(
        waiter.sent
          ? `Exegol MCP disconnected while your call was in flight — it may or may not have run.${waiter.recoveryHint}`
          : "Exegol MCP disconnected (the app is restarting or was closed) — the call was NOT executed; retry in a moment",
      ),
    );
  }
}

function scheduleReconnect(): void {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  const timer = setTimeout(() => {
    reconnectScheduled = false;
    connectSocket();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  timer.unref?.();
}

function connectSocket(): void {
  const sock = connect(MCP_SOCK_PATH);
  sock.on("connect", () => {
    socket = sock;
    reconnectDelay = RECONNECT_BASE_MS;
    loggedThisOutage = false;
    for (const { id, payload } of outbox.splice(0)) {
      const waiter = pending.get(id);
      if (!waiter) continue; // dropped: the caller already timed out
      sock.write(payload);
      waiter.sent = true;
    }
  });
  sock.on(
    "data",
    createNdjsonBuffer<JsonRpcResponse>((res) => {
      const waiter = pending.get(res.id);
      if (!waiter) return;
      pending.delete(res.id);
      if (res.error) waiter.reject(new Error(res.error.message));
      else waiter.resolve(res.result);
    }),
  );
  sock.on("error", (err) => {
    // Null the socket HERE too: `error` precedes `close` asynchronously, and a
    // call issued in that window would be written to a destroyed stream and
    // silently lost instead of landing in the outbox.
    if (socket === sock) socket = null;
    if (!loggedThisOutage) {
      process.stderr.write(`[exegol-mcp-shim] socket error: ${err.message} (retrying)\n`);
      loggedThisOutage = true;
    }
  });
  sock.on("close", () => {
    if (socket === sock) {
      socket = null;
      rejectAllPending();
    }
    sock.destroy();
    scheduleReconnect();
  });
}

connectSocket();

function socketWritable(): boolean {
  return !!socket && !socket.destroyed && socket.writable;
}

function callSocket(
  method: string,
  params: Record<string, unknown>,
  label = method,
): Promise<unknown> {
  const id = nextSocketId++;
  // Whether the request reached the wire decides what a timeout MEANS: still in
  // the outbox = definitely not executed; already written = unknown, it may
  // have run and lost the ack. Reporting the second as the first is what made
  // an agent re-send a message it had already delivered (2026-08-13).
  return new Promise((resolve, reject) => {
    const entry: PendingCall = {
      resolve,
      reject,
      sent: false,
      recoveryHint: recoveryHintFor(label),
    };
    pending.set(id, entry);
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        // Drop the queued payload too, or a reconnect would replay a call the
        // caller already gave up on.
        const idx = outbox.findIndex((e) => e.id === id);
        if (idx !== -1) outbox.splice(idx, 1);
        reject(
          new Error(
            entry.sent
              ? `Exegol MCP did not answer "${label}" in 30s. The call REACHED the app, so it may or may not have run — do NOT blindly retry.${entry.recoveryHint}`
              : `Exegol MCP unreachable — is the Exegol app running? ("${label}" was NOT executed; retrying is safe.)`,
          ),
        );
      }
    }, CALL_TIMEOUT_MS);
    timer.unref?.();
    const payload = encodeRequest(id, method, params);
    if (socketWritable()) {
      socket?.write(payload);
      entry.sent = true;
      return;
    }
    if (outbox.length >= MAX_OUTBOX) {
      const dropped = outbox.shift();
      if (dropped) pending.get(dropped.id)?.reject(new Error("Exegol MCP outbox full — dropped"));
    }
    outbox.push({ id, payload });
  });
}

async function callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await callSocket("call_tool", { tool, args, token, ppid: process.ppid }, tool);
  } catch (err) {
    // A stale token (app restarted, config rewritten) is permanent for the rest
    // of the session unless we re-read it: the file on disk may already hold a
    // freshly re-armed one.
    if (err instanceof Error && err.message.includes("EXEGOL_MCP_TOKEN")) {
      const fresh = resolveToken();
      if (fresh && fresh !== token) {
        token = fresh;
        process.stderr.write("[exegol-mcp-shim] token refreshed from disk, retrying\n");
        return callSocket("call_tool", { tool, args, token, ppid: process.ppid }, tool);
      }
    }
    throw err;
  }
}

// ─── MCP protocol handling ──────────────────────────────────────────────────

function handleClientMessage(
  msg: { id?: number | string; method: string; params?: unknown },
  framed: boolean,
): void {
  if (msg.id === undefined) return; // notification — nothing to reply to

  switch (msg.method) {
    case "initialize": {
      const requested = (msg.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      writeToClient(msg.id, framed, {
        protocolVersion: requested ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "exegol", version: "1.0.0" },
      });
      return;
    }

    case "ping":
      writeToClient(msg.id, framed, {});
      return;

    case "tools/list": {
      // T163 stale-shim fix: ask the RUNNING app for tool defs so a shim
      // spawned by an old session still lists tools added since. The bundled
      // defs are only the offline fallback.
      const fallback = () => getToolDefsForAccessMode(displayMode);
      // Socket down (app closed / restarting): answer from the bundle NOW.
      // Queuing this behind the 30s call timeout made the client sit through
      // a silent initialization stall and mark the server failed — the exact
      // "sigue conectando" symptom.
      if (!socket) {
        writeToClient(msg.id, framed, { tools: fallback() });
        return;
      }
      callSocket("list_tools", { token, ppid: process.ppid })
        .then((result) => {
          const tools = (result as { tools?: unknown[] } | null)?.tools;
          writeToClient(msg.id as number, framed, { tools: tools?.length ? tools : fallback() });
        })
        .catch(() => {
          writeToClient(msg.id as number, framed, { tools: fallback() });
        });
      return;
    }

    case "tools/call": {
      const params = msg.params as { name: string; arguments?: Record<string, unknown> };
      callTool(params.name, params.arguments ?? {})
        .then((result) => {
          writeToClient(msg.id as number, framed, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        })
        .catch((err: Error) => {
          writeToClient(msg.id as number, framed, {
            content: [{ type: "text", text: err.message }],
            isError: true,
          });
        });
      return;
    }

    default:
      writeToClient(msg.id, framed, undefined, {
        code: -32601,
        message: `Unknown method: ${msg.method}`,
      });
  }
}
