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
// Token fallback chain: env (claude/opencode/gemini pass it via their config
// env) → <cwd>/.mcp.json (codex sanitizes MCP-server env, so Exegol drops the
// token on disk in the session cwd instead — 2026-08-12).
function resolveToken(): string {
  const fromEnv = process.env.EXEGOL_MCP_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(join(process.cwd(), ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: { exegol?: { env?: { EXEGOL_MCP_TOKEN?: string } } };
    };
    return parsed.mcpServers?.exegol?.env?.EXEGOL_MCP_TOKEN ?? "";
  } catch {
    return "";
  }
}

const token = resolveToken();
const displayMode = (process.env.EXEGOL_ACCESS_MODE as ExegolAccessMode) ?? "read";

// ─── stdio framing ──────────────────────────────────────────────────────────
// MCP-over-stdio is newline-delimited JSON (what Claude Code and every spec
// client sends). The original shim spoke Content-Length/LSP framing, so
// clients hung forever on "connecting". Auto-detect per message and reply in
// whichever framing the client used (framed kept for host.ts-style clients).

let stdinBuffer = "";
let clientUsesFraming = false;
process.stdin.on("data", (chunk: Buffer) => {
  stdinBuffer += chunk.toString("utf-8");
  processStdinBuffer();
});

function processStdinBuffer(): void {
  for (;;) {
    const trimmed = stdinBuffer.replace(/^[\r\n\s]+/, "");
    if (trimmed !== stdinBuffer) stdinBuffer = trimmed;
    if (stdinBuffer.length === 0) return;

    if (stdinBuffer.startsWith("Content-Length:")) {
      const headerEnd = stdinBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const match = stdinBuffer.slice(0, headerEnd).match(/Content-Length:\s*(\d+)/i);
      const contentLength = Number.parseInt(match?.[1] ?? "0", 10);
      const contentStart = headerEnd + 4;
      if (stdinBuffer.length < contentStart + contentLength) return;
      const content = stdinBuffer.slice(contentStart, contentStart + contentLength);
      stdinBuffer = stdinBuffer.slice(contentStart + contentLength);
      clientUsesFraming = true;
      dispatchRaw(content);
      continue;
    }

    const nl = stdinBuffer.indexOf("\n");
    if (nl === -1) return;
    const line = stdinBuffer.slice(0, nl).trim();
    stdinBuffer = stdinBuffer.slice(nl + 1);
    if (line.length === 0) continue;
    clientUsesFraming = false;
    dispatchRaw(line);
  }
}

function dispatchRaw(content: string): void {
  try {
    handleClientMessage(JSON.parse(content));
  } catch (err) {
    process.stderr.write(`[exegol-mcp-shim] failed to parse client message: ${err}\n`);
  }
}

function writeToClient(
  id: number | string,
  result?: unknown,
  error?: { code: number; message: string },
): void {
  const body = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result: result ?? null };
  const msg = JSON.stringify(body);
  if (clientUsesFraming) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, "utf-8")}\r\n\r\n${msg}`);
  } else {
    process.stdout.write(`${msg}\n`);
  }
}

// ─── Unix socket connection to the main process ────────────────────────────

let nextSocketId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const CALL_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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

function rejectAllPending(reason: string): void {
  for (const [id, waiter] of pending) {
    pending.delete(id);
    waiter.reject(new Error(reason));
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
      if (pending.has(id)) sock.write(payload); // drop calls that already timed out
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
    if (!loggedThisOutage) {
      process.stderr.write(`[exegol-mcp-shim] socket error: ${err.message} (retrying)\n`);
      loggedThisOutage = true;
    }
  });
  sock.on("close", () => {
    if (socket === sock) {
      socket = null;
      rejectAllPending("Exegol MCP disconnected (app restarting?) — reconnecting, retry shortly");
    }
    sock.destroy();
    scheduleReconnect();
  });
}

connectSocket();

function callSocket(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = nextSocketId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Exegol MCP call timed out (${method})`));
    }, CALL_TIMEOUT_MS);
    timer.unref?.();
    const payload = encodeRequest(id, method, params);
    if (socket) socket.write(payload);
    else outbox.push({ id, payload });
  });
}

function callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  return callSocket("call_tool", { tool, args, token });
}

// ─── MCP protocol handling ──────────────────────────────────────────────────

function handleClientMessage(msg: {
  id?: number | string;
  method: string;
  params?: unknown;
}): void {
  if (msg.id === undefined) return; // notification — nothing to reply to

  switch (msg.method) {
    case "initialize": {
      const requested = (msg.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      writeToClient(msg.id, {
        protocolVersion: requested ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "exegol", version: "1.0.0" },
      });
      return;
    }

    case "ping":
      writeToClient(msg.id, {});
      return;

    case "tools/list": {
      // T163 stale-shim fix: ask the RUNNING app for tool defs so a shim
      // spawned by an old session still lists tools added since. The bundled
      // defs are only the offline fallback.
      const fallback = () =>
        getToolDefsForAccessMode(displayMode).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      callSocket("list_tools", { token })
        .then((result) => {
          const tools = (result as { tools?: unknown[] } | null)?.tools;
          writeToClient(msg.id as number, { tools: tools?.length ? tools : fallback() });
        })
        .catch(() => {
          writeToClient(msg.id as number, { tools: fallback() });
        });
      return;
    }

    case "tools/call": {
      const params = msg.params as { name: string; arguments?: Record<string, unknown> };
      callTool(params.name, params.arguments ?? {})
        .then((result) => {
          writeToClient(msg.id as number, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        })
        .catch((err: Error) => {
          writeToClient(msg.id as number, {
            content: [{ type: "text", text: err.message }],
            isError: true,
          });
        });
      return;
    }

    default:
      writeToClient(msg.id, undefined, { code: -32601, message: `Unknown method: ${msg.method}` });
  }
}
