/**
 * T145 — Exegol MCP tool handlers: memory_search, memory_save, knowledge_get.
 * Every write is attributed via `context.agentId` (signed by the caller's
 * EXEGOL_AGENT_ID env, forwarded through the shim); access mode (T58) gates
 * which tools a `read`/`plan` agent may call — the store decides, the agent
 * can't corrupt data even if it tries.
 */

import { existsSync, readFileSync } from "node:fs";
import type { MemoryCategory } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import { AgentMessagingError, sendAgentMessage } from "../agents/agent-messaging";
import { getProject } from "../db/queries";
import { listActiveAgents } from "../db/queries/agents";
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

/** T157: other live agents the caller can message — the caller itself is excluded. */
function handleAgentsList(db: Database.Database, context: ExegolToolContext) {
  return {
    agents: listActiveAgents(db)
      .filter((a) => a.id !== context.agentId)
      .map((a) => ({
        id: a.id,
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
  const targetId = String(args.target_id ?? "");
  const message = String(args.message ?? "");
  if (!targetId) throw new ExegolToolError("agent_send requires target_id", -32602);
  try {
    const result = sendAgentMessage(db, {
      fromAgentId: context.agentId,
      toAgentId: targetId,
      text: message,
    });
    return {
      messageId: result.messageId,
      status: result.delivered ? "delivered" : "queued_for_next_turn_boundary",
    };
  } catch (err) {
    if (err instanceof AgentMessagingError) throw new ExegolToolError(err.message, err.code);
    throw err;
  }
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

  switch (toolName) {
    case "memory_search":
      return handleMemorySearch(db, args, context);
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
  }
}
