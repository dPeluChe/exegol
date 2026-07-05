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

import { connect } from "node:net";
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
const token = process.env.EXEGOL_MCP_TOKEN ?? "";
const displayMode = (process.env.EXEGOL_ACCESS_MODE as ExegolAccessMode) ?? "read";

// ─── stdio framing (Content-Length, mirrors host.ts's StdioTransport) ──────

let stdinBuffer = "";
process.stdin.on("data", (chunk: Buffer) => {
  stdinBuffer += chunk.toString("utf-8");
  processStdinBuffer();
});

function processStdinBuffer(): void {
  for (;;) {
    const headerEnd = stdinBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = stdinBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      stdinBuffer = stdinBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(match[1] ?? "0", 10);
    const contentStart = headerEnd + 4;
    if (stdinBuffer.length < contentStart + contentLength) return;

    const content = stdinBuffer.slice(contentStart, contentStart + contentLength);
    stdinBuffer = stdinBuffer.slice(contentStart + contentLength);

    try {
      handleClientMessage(JSON.parse(content));
    } catch (err) {
      process.stderr.write(`[exegol-mcp-shim] failed to parse client message: ${err}\n`);
    }
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
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, "utf-8")}\r\n\r\n${msg}`);
}

// ─── Unix socket connection to the main process ────────────────────────────

const socket = connect(MCP_SOCK_PATH);
let nextSocketId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const CALL_TIMEOUT_MS = 30_000;

function rejectAllPending(reason: string): void {
  for (const [id, waiter] of pending) {
    pending.delete(id);
    waiter.reject(new Error(reason));
  }
}

socket.on(
  "data",
  createNdjsonBuffer<JsonRpcResponse>((res) => {
    const waiter = pending.get(res.id);
    if (!waiter) return;
    pending.delete(res.id);
    if (res.error) waiter.reject(new Error(res.error.message));
    else waiter.resolve(res.result);
  }),
);

// Exegol quitting or the socket dropping must not leave the agent CLI hung
// on an MCP call forever — reject everything in flight.
socket.on("error", (err) => {
  process.stderr.write(`[exegol-mcp-shim] socket error: ${err.message}\n`);
  rejectAllPending(`Exegol MCP socket error: ${err.message}`);
});
socket.on("close", () => {
  rejectAllPending("Exegol MCP socket closed (app quit?)");
});

function callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const id = nextSocketId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Exegol MCP call timed out (${tool})`));
    }, CALL_TIMEOUT_MS);
    timer.unref?.();
    socket.write(encodeRequest(id, "call_tool", { tool, args, token }));
  });
}

// ─── MCP protocol handling ──────────────────────────────────────────────────

function handleClientMessage(msg: {
  id?: number | string;
  method: string;
  params?: unknown;
}): void {
  if (msg.id === undefined) return; // notification — nothing to reply to

  switch (msg.method) {
    case "initialize":
      writeToClient(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "exegol", version: "1.0.0" },
      });
      return;

    case "tools/list": {
      const tools = getToolDefsForAccessMode(displayMode).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      writeToClient(msg.id, { tools });
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
