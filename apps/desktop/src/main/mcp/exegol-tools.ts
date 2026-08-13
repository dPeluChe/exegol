/**
 * T145 — Exegol MCP tool handlers: memory_search, memory_save, knowledge_get.
 * Every write is attributed via `context.agentId` (signed by the caller's
 * EXEGOL_AGENT_ID env, forwarded through the shim); access mode (T58) gates
 * which tools a `read`/`plan` agent may call — the store decides, the agent
 * can't corrupt data even if it tries.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryCategory } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import {
  AgentMessagingError,
  cancelQueuedMessage,
  checkAgentMessages,
  getMessageDeliveryState,
  noteAgentHasLink,
  resolveTargetAgent,
  sendAgentMessage,
} from "../agents/agent-messaging";
import { getProject } from "../db/queries";
import {
  AGENT_LINK_ROLES,
  type AgentLinkRole,
  createAgentLink,
  reverseLinkExists,
} from "../db/queries/agent-links";
import { listActiveAgents } from "../db/queries/agents";
import { claimPaths, listProjectClaims, releasePaths } from "../db/queries/path-claims";
import { getWorktreeByAgentId } from "../db/queries/worktrees";
import { readProjectBrief } from "../knowledge/brief";
import { getDigestPath } from "../knowledge/paths";
import { listMemories, observeMemory, searchMemories } from "../memory/store";
import {
  EXEGOL_TOOL_NAMES,
  type ExegolToolContext,
  type ExegolToolName,
  SEARCH_ONLY_TOOLS,
} from "./exegol-protocol";

// Tool definitions live in exegol-protocol.ts (dependency-free) so the shim
// bundle never drags this module's memory/knowledge/db import graph.
export { EXEGOL_TOOL_DEFS, getToolDefsForAccessMode } from "./exegol-protocol";

export class ExegolToolError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}

function requireWriteAccess(tool: ExegolToolName, context: ExegolToolContext): void {
  if (SEARCH_ONLY_TOOLS.has(tool)) return;
  if (context.accessMode !== "write") {
    throw new ExegolToolError(
      `Tool "${tool}" requires write access (agent is in "${context.accessMode}" mode)`,
      -32001,
    );
  }
}

async function handleMemorySearch(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const query = String(args.query ?? "");
  if (!query) throw new ExegolToolError("memory_search requires a non-empty query", -32602);

  const category = typeof args.category === "string" ? (args.category as MemoryCategory) : null;
  const results = await searchMemories(db, context.projectId, query);
  const filtered = category ? results.filter((m) => m.category === category) : results;

  return {
    facts: filtered.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      relevanceScore: m.relevanceScore,
    })),
  };
}

function handleMemoryList(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
  const category = typeof args.category === "string" ? (args.category as MemoryCategory) : null;
  const all = listMemories(db, context.projectId);
  const filtered = category ? all.filter((m) => m.category === category) : all;
  return {
    total: filtered.length,
    facts: filtered.slice(0, limit).map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      relevanceScore: m.relevanceScore,
    })),
  };
}

function handleMemorySave(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const fact = String(args.fact ?? "");
  const category = args.category as MemoryCategory;
  if (!fact) throw new ExegolToolError("memory_save requires a non-empty fact", -32602);
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw new ExegolToolError(
      `memory_save requires a valid category (one of ${MEMORY_CATEGORIES.join(", ")})`,
      -32602,
    );
  }

  const id = observeMemory(db, {
    projectId: context.projectId,
    category,
    content: fact,
    sourceAgentId: context.agentId,
    relevanceScore: 0.6,
  });
  return { id };
}

function handleKnowledgeGet(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const project = getProject(db, context.projectId);
  if (!project) throw new ExegolToolError(`Project ${context.projectId} not found`, -32603);

  // STRICTLY read-only: this runs for read/plan agents too — creating
  // PROJECT.md or regenerating DIGEST.md here would dirty the user's repo
  // from a read call (and violate the read-mode contract).
  const section = typeof args.section === "string" ? args.section : null;
  const result: { brief?: string | null; digest?: string | null } = {};

  if (section === "brief" || !section) {
    result.brief = readProjectBrief(project.path);
  }
  if (section === "digest" || !section) {
    const digestPath = getDigestPath(project.path);
    result.digest = existsSync(digestPath) ? readFileSync(digestPath, "utf-8") : null;
  }
  return result;
}

/** T157: other live agents the caller can message, plus the caller's OWN
 *  identity (agents didn't know their own session name — "me llamó Juanito y
 *  no sé de dónde salió", 2026-08-12). */
function handleAgentsList(db: Database.Database, context: ExegolToolContext) {
  const all = listActiveAgents(db);
  const me = all.find((a) => a.id === context.agentId);
  // Shape is a CONTRACT: `self` and `agents` are always present, so a client
  // can destructure without guarding (a caller crashed when an early response
  // omitted `self` — Juanito, 2026-08-13).
  return {
    self: {
      id: context.agentId,
      name: me?.alias ?? null,
      note: "This is YOU. Sign messages with this name; others reach you via agent_send with it. Your id and name do not change for the rest of this session.",
    },
    agents: all
      .filter((a) => a.id !== context.agentId)
      .map((a) => ({
        id: a.id,
        name: a.alias ?? null,
        provider: a.cliType,
        project: a.projectName,
        status: a.status,
        task: a.taskDescription.slice(0, 120),
      })),
  };
}

/** T157: sender identity comes from context (token-derived) — never from args. */
function handleAgentSend(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  // `target` (name or id) is canonical; `target_id` accepted for compatibility.
  const targetId = String(args.target ?? "");
  const message = String(args.message ?? "");
  if (!targetId) throw new ExegolToolError("agent_send requires target (name or id)", -32602);
  const result = sendAgentMessage(db, {
    fromAgentId: context.agentId,
    toAgentId: targetId,
    text: message,
    expectsReply: args.expects_reply !== false,
    clientKey: typeof args.message_id === "string" ? args.message_id.slice(0, 200) : undefined,
    inReplyTo: typeof args.in_reply_to === "string" ? args.in_reply_to : undefined,
  });
  return {
    messageId: result.messageId,
    status: result.delivered ? "delivered" : "queued_for_next_turn_boundary",
    ...(result.duplicate
      ? { duplicate: true, note: "Already sent earlier with this message_id — not re-sent." }
      : {}),
  };
}

/** T165: make delivery observable, so an ambiguous timeout isn't guessed at. */
function handleMessageStatus(args: Record<string, unknown>, context: ExegolToolContext) {
  const messageId = String(args.message_id ?? "");
  if (!messageId) throw new ExegolToolError("message_status requires message_id", -32602);
  return getMessageDeliveryState(messageId, context.agentId);
}

/** T172: a queued message is still ours — withdrawing it beats sending a
 *  correction and hoping both are read in order. */
function handleMessageCancel(args: Record<string, unknown>, context: ExegolToolContext) {
  const messageId = String(args.message_id ?? "");
  if (!messageId) throw new ExegolToolError("message_cancel requires message_id", -32602);
  return cancelQueuedMessage(messageId, context.agentId);
}

// ─── T172: path claims ───────────────────────────────────────────────────────

/** Claims are stored absolute so agents in separate worktrees never collide;
 *  agents think in paths relative to where they are working. */
function resolveAgentPaths(
  db: Database.Database,
  context: ExegolToolContext,
  raw: unknown,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ExegolToolError("paths must be a non-empty array of files or directories", -32602);
  }
  const worktree = getWorktreeByAgentId(db, context.agentId);
  const project = getProject(db, context.projectId);
  const base = worktree?.path ?? project?.path;
  if (!base) throw new ExegolToolError("cannot resolve this agent's working directory", -32603);
  return raw.map((p) => {
    const path = String(p).trim();
    if (!path) throw new ExegolToolError("paths must not contain empty entries", -32602);
    // Normalize away trailing slashes and "..", so `src/` and `src` are one
    // claim and a traversal can't quietly widen a claim's reach.
    return resolve(base, path);
  });
}

function handleClaimPaths(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const paths = resolveAgentPaths(db, context, args.paths);
  const result = claimPaths(db, {
    agentId: context.agentId,
    projectId: context.projectId,
    paths,
    note: typeof args.note === "string" ? args.note.slice(0, 300) : null,
  });
  if (result.conflicts.length > 0) {
    return {
      granted: false,
      conflicts: result.conflicts.map((c) => ({
        path: c.path,
        heldBy: c.heldByName ?? c.heldBy,
        note: c.note,
      })),
      hint: "Nothing was claimed. Pick different files, or message the holder with agent_send to agree who takes what.",
    };
  }
  return { granted: true, paths: result.granted };
}

function handleReleasePaths(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const paths = args.paths === undefined ? undefined : resolveAgentPaths(db, context, args.paths);
  return releasePaths(db, context.agentId, paths);
}

function handleListClaims(db: Database.Database, context: ExegolToolContext) {
  return {
    claims: listProjectClaims(db, context.projectId).map((c) => ({
      path: c.path,
      heldBy: c.heldByName ?? c.agentId,
      isYours: c.agentId === context.agentId,
      note: c.note,
    })),
  };
}

/** T162: register an Exegol-enforced link FROM the caller (identity from token). */
function handleAgentLink(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const targetRaw = String(args.target ?? "");
  if (!targetRaw) throw new ExegolToolError("agent_link requires target (name or id)", -32602);
  const role = (AGENT_LINK_ROLES as readonly string[]).includes(String(args.role))
    ? (String(args.role) as AgentLinkRole)
    : "notify";
  const target = resolveTargetAgent(db, targetRaw);
  if (target.id === context.agentId) {
    throw new ExegolToolError("cannot link to yourself", -32602);
  }
  const once = args.once !== false;
  // Cycle guard: a recurring (once:false) link whose reverse already exists is
  // a perpetual A↔B notify machine (simplify A7). One-shots are self-limiting.
  if (!once && reverseLinkExists(db, context.agentId, target.id)) {
    throw new ExegolToolError(
      "a recurring link in the reverse direction already exists — would loop forever",
      -32015,
    );
  }
  const link = createAgentLink(db, {
    fromAgentId: context.agentId,
    toAgentId: target.id,
    role,
    note: typeof args.note === "string" ? args.note.slice(0, 500) : null,
    once,
  });
  noteAgentHasLink(context.agentId);
  return {
    linkId: link.id,
    firesWhen: "your current turn ends",
    target: target.alias ?? target.id,
    role: link.role,
    once: link.once,
  };
}

/** Dispatch a tool call, enforcing access-mode gating before running the handler. */
export async function callExegolTool(
  db: Database.Database,
  tool: string,
  args: Record<string, unknown>,
  context: ExegolToolContext,
): Promise<unknown> {
  if (!(EXEGOL_TOOL_NAMES as readonly string[]).includes(tool)) {
    throw new ExegolToolError(`Unknown tool: ${tool}`, -32601);
  }
  const toolName = tool as ExegolToolName;
  requireWriteAccess(toolName, context);

  // Single translation point: messaging throws AgentMessagingError (its own
  // JSON-RPC codes), which the socket layer surfaces to the agent verbatim.
  try {
    switch (toolName) {
      case "memory_search":
        return await handleMemorySearch(db, args, context);
      case "memory_list":
        return handleMemoryList(db, args, context);
      case "memory_save":
        return handleMemorySave(db, args, context);
      case "knowledge_get":
        return handleKnowledgeGet(db, args, context);
      case "agents_list":
        return handleAgentsList(db, context);
      case "agent_send":
        return handleAgentSend(db, args, context);
      case "message_status":
        return handleMessageStatus(args, context);
      case "message_cancel":
        return handleMessageCancel(args, context);
      case "messages_check":
        return checkAgentMessages(context.agentId);
      case "claim_paths":
        return handleClaimPaths(db, args, context);
      case "release_paths":
        return handleReleasePaths(db, args, context);
      case "list_claims":
        return handleListClaims(db, context);
      case "agent_link":
        return handleAgentLink(db, args, context);
    }
  } catch (err) {
    if (err instanceof AgentMessagingError) throw new ExegolToolError(err.message, err.code);
    throw err;
  }
}
