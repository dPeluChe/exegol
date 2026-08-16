/**
 * T145 — Shared protocol between the main process (exegol-server.ts) and the
 * standalone shim binaries (exegol-mcp-shim-bin.ts, exegol-ctl-bin.ts).
 * Newline-delimited JSON-RPC 2.0 over a Unix domain socket, mirroring the PTY
 * sidecar's `pty-sidecar-protocol.ts` framing for consistency across the app.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
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

/** A newline-less stream would grow the frame buffer without bound — and in the
 *  main process that is the whole app. Nothing legitimate approaches it: the
 *  largest message is a tool result, and agent_send caps its body far below. */
export const MAX_NDJSON_LINE_CHARS = 8 * 1024 * 1024;

/**
 * Buffers arbitrary chunks and yields complete newline-delimited JSON messages.
 * Shared by the server and both bin scripts so socket framing stays in one place.
 */
export function createNdjsonBuffer<T>(
  onMessage: (msg: T) => void,
  onOverflow?: () => void,
): (chunk: Buffer | string) => void {
  // StringDecoder, not per-chunk toString: a multibyte character split across
  // a chunk boundary would otherwise decode to U+FFFD on both sides and the
  // message would fail to parse (tool results carry user prose — acentos).
  const decoder = new StringDecoder("utf-8");
  let buffer = "";
  let overflowed = false;
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (buffer.length > MAX_NDJSON_LINE_CHARS) {
      // Drop what we hold and stay in the discard state until a newline gives
      // us a fresh frame boundary — resuming mid-message would parse garbage.
      const resumeAt = buffer.lastIndexOf("\n");
      buffer = resumeAt === -1 ? "" : buffer.slice(resumeAt + 1);
      if (!overflowed) {
        overflowed = true;
        onOverflow?.();
      }
      if (resumeAt === -1) return;
    }
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.trim().length > 0) {
        try {
          onMessage(JSON.parse(line) as T);
          // A parsed message means the framing recovered; the next flood is a
          // new incident and worth reporting again.
          overflowed = false;
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
  /** Shim's parent pid — disambiguates agents that share a config file. */
  ppid?: number;
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
  "message_status",
  "message_cancel",
  "messages_check",
  "agent_link",
  "claim_paths",
  "release_paths",
  "list_claims",
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
  "message_status",
  "message_cancel",
  "messages_check",
  "agent_link",
  // Claims are coordination, not repo writes: a read/plan agent must be able to
  // reserve the files it is about to report on.
  "claim_paths",
  "release_paths",
  "list_claims",
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
      "List live agents orchestrated by Exegol (all projects). The response ALWAYS has " +
      "both keys: `self` (YOUR session id + name — sign with it; `name` may be null) and " +
      "`agents` (the others: id, name, provider, project, status, task; may be an empty " +
      "array). Ids and names are stable for the whole session — cache them. Address " +
      "agent_send by name when set, or by id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agent_send",
    description:
      "Send a text message to another live agent, addressed by session name (alias) or " +
      "id. Exegol delivers it at the target's next turn boundary (never mid-generation) " +
      "with your identity attached — the target knows it came from an agent, not the " +
      "user. Set expects_reply=false on closing messages so the exchange can END instead " +
      "of ping-ponging forever. Pass message_id (any unique string you make up) so that " +
      "retrying after a timeout can never deliver the same message twice. Returns " +
      "{messageId, status: delivered|queued_for_next_turn_boundary, duplicate?}.",
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
        message_id: {
          type: "string",
          description:
            "Idempotency key you generate. If a call times out, retry with the SAME value: " +
            "Exegol returns the original result (duplicate:true) instead of sending again.",
        },
        in_reply_to: {
          type: "string",
          description:
            "Id of the Exegol message you are answering (shown in its header) — threads the exchange.",
        },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "message_status",
    description:
      "Check what happened to a message you sent (or received) when a call timed out and " +
      "you can't tell whether it went through. Returns state: delivered | queued " +
      "(with queuePosition) | undeliverable (the target's session ended) | unknown.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "The messageId returned by agent_send" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "message_cancel",
    description:
      "Withdraw a message you sent that has NOT been delivered yet (still queued for the " +
      "target's next turn boundary). Use it when an assignment turns out to be wrong instead " +
      "of sending a correction and hoping both are read in order. Fails if it already landed.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "The messageId returned by agent_send" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "messages_check",
    description:
      "Fetch the full body of messages too long to paste into your terminal. When another " +
      "agent sends you something large, Exegol delivers a one-line pointer and holds the body " +
      "here — call this to read it. Reading DRAINS them, so process what you get; the sender " +
      "sees the message as consumed once you do.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claim_paths",
    description:
      "Reserve files or directories before editing them, so two agents never write the same " +
      "file — ENFORCED for sessions Exegol can intercept (their file-editing tools are " +
      "blocked), advisory for the rest; the response says which is which. Writes made " +
      "through shell commands are never intercepted. ALL-OR-NOTHING: if any path overlaps another live agent's claim, nothing is " +
      "granted and you get the conflicts (who holds what) — pick different files or negotiate " +
      "via agent_send. A directory claim covers everything under it. Re-claiming what you " +
      "already hold succeeds. Paths may be relative to your working directory. Your claims are " +
      "released automatically when your session ends.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files or directories, e.g. ['src/auth/login.ts', 'convex/']",
        },
        note: {
          type: "string",
          description: "Why you need them — shown to an agent that hits the conflict",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "release_paths",
    description:
      "Give back path claims once you are done, so another agent can take them. Omit `paths` " +
      "to release everything you hold.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
    },
  },
  {
    name: "list_claims",
    description:
      "Who currently holds which paths in this project. Call it BEFORE handing out work: it " +
      "turns 'hope nobody else is in this file' into a fact.",
    inputSchema: { type: "object", properties: {} },
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
