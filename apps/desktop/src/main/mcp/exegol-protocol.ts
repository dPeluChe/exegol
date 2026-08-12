/**
 * T145 — Shared protocol between the main process (exegol-server.ts) and the
 * standalone shim binaries (exegol-mcp-shim-bin.ts, exegol-ctl-bin.ts).
 * Newline-delimited JSON-RPC 2.0 over a Unix domain socket, mirroring the PTY
 * sidecar's `pty-sidecar-protocol.ts` framing for consistency across the app.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { MEMORY_CATEGORIES } from "@exegol/shared";

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
export function createNdjsonBuffer<T>(
  onMessage: (msg: T) => void,
): (chunk: Buffer | string) => void {
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
}

// ─── Tool definitions ────────────────────────────────────────────────────────
// Live here (dependency-free module) so the standalone shim can list tools
// without dragging the memory/knowledge/db import graph into its bundle.

export const EXEGOL_TOOL_NAMES = [
  "memory_search",
  "memory_list",
  "memory_save",
  "knowledge_get",
  "agents_list",
  "agent_send",
  "agent_link",
] as const;
export type ExegolToolName = (typeof EXEGOL_TOOL_NAMES)[number];

/** Tools a read/plan agent may still call — everything else needs write access.
 *  Messaging (T157) is not a repo write: read/plan agents may coordinate too. */
export const SEARCH_ONLY_TOOLS = new Set<ExegolToolName>([
  "memory_search",
  "memory_list",
  "knowledge_get",
  "agents_list",
  "agent_send",
  "agent_link",
]);

export interface ExegolToolDef {
  name: ExegolToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MEMORY_CATEGORY_VALUES = [...MEMORY_CATEGORIES];

export const EXEGOL_TOOL_DEFS: ExegolToolDef[] = [
  {
    name: "memory_search",
    description: "Hybrid RRF search over this project's memory store. Returns top facts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string", enum: MEMORY_CATEGORY_VALUES },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_list",
    description:
      "List this project's most relevant memories (no query needed — use this to see " +
      "what the store knows). Optional category filter and limit (default 10, max 30).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        category: { type: "string", enum: MEMORY_CATEGORY_VALUES },
      },
    },
  },
  {
    name: "memory_save",
    description:
      "Record a fact into this project's memory store. The store decides whether to " +
      "reinforce an existing fact, supersede a contradicting one, or create a new entry.",
    inputSchema: {
      type: "object",
      properties: {
        fact: { type: "string" },
        category: { type: "string", enum: MEMORY_CATEGORY_VALUES },
      },
      required: ["fact", "category"],
    },
  },
  {
    name: "knowledge_get",
    description:
      "Read this project's knowledge base. `section` is 'brief' (PROJECT.md) or " +
      "'digest' (auto-generated structure summary); omit for both.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["brief", "digest"] },
      },
    },
  },
  {
    name: "agents_list",
    description:
      "List live agents orchestrated by Exegol (all projects). Returns `self` (YOUR " +
      "session id + name — sign with it) and `agents` (the others: id, name, provider, " +
      "project, status, task). Address agent_send by name when set, or by id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agent_send",
    description:
      "Send a text message to another live agent, addressed by session name (alias) or " +
      "id. Exegol delivers it at the target's next turn boundary (never mid-generation) " +
      "with your identity attached — the target knows it came from an agent, not the " +
      "user. Set expects_reply=false on closing messages so the exchange can END instead " +
      "of ping-ponging forever. Returns delivered|queued.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Session name (alias) or agent id from agents_list",
        },
        message: { type: "string", description: "Plain text, max 4000 chars" },
        expects_reply: {
          type: "boolean",
          description:
            "Default true: tells the receiver you await their reply. Use false for FYI/closing messages.",
        },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "agent_link",
    description:
      "Register an Exegol-ENFORCED link: when YOUR current turn ends, Exegol automatically " +
      "notifies the target agent (with your identity attached) — use this for 'when I " +
      "finish, tell X' so the notification happens even if you forget. Roles: notify " +
      "(FYI), reviewer (target reviews your work), feedback. One-shot by default.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Session name (alias) or agent id" },
        role: { type: "string", enum: ["notify", "reviewer", "feedback"] },
        note: { type: "string", description: "Context included in the notification" },
        once: {
          type: "boolean",
          description:
            "Default true (fire on your next turn end, then expire). false = every turn.",
        },
      },
      required: ["target"],
    },
  },
];

/** Tool defs visible at the given access mode (display-only in the shim — the
 *  server re-derives the mode from the DB and enforces it on every call). */
export function getToolDefsForAccessMode(accessMode: ExegolAccessMode): ExegolToolDef[] {
  if (accessMode === "write") return EXEGOL_TOOL_DEFS;
  return EXEGOL_TOOL_DEFS.filter((t) => SEARCH_ONLY_TOOLS.has(t.name));
}
