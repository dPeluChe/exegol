/**
 * T145 — Exegol MCP tool handlers: memory_search, memory_save, knowledge_get.
 * Every write is attributed via `context.agentId` (signed by the caller's
 * EXEGOL_AGENT_ID env, forwarded through the shim); access mode (T58) gates
 * which tools a `read`/`plan` agent may call — the store decides, the agent
 * can't corrupt data even if it tries.
 */

import type { MemoryCategory } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import { getProject } from "../db/queries";
import { ensureProjectBrief } from "../knowledge/brief";
import { refreshDigestIfStale } from "../knowledge/staleness";
import { observeMemory, searchMemories } from "../memory/store";
import type { ExegolAccessMode, ExegolToolContext } from "./exegol-protocol";

export const EXEGOL_TOOL_NAMES = ["memory_search", "memory_save", "knowledge_get"] as const;
export type ExegolToolName = (typeof EXEGOL_TOOL_NAMES)[number];

/** Tools a read/plan agent may still call — everything else needs write access. */
const SEARCH_ONLY_TOOLS = new Set<ExegolToolName>(["memory_search", "knowledge_get"]);

export interface ExegolToolDef {
  name: ExegolToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const EXEGOL_TOOL_DEFS: ExegolToolDef[] = [
  {
    name: "memory_search",
    description: "Hybrid RRF search over this project's memory store. Returns top facts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string", enum: MEMORY_CATEGORIES },
      },
      required: ["query"],
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
        category: { type: "string", enum: MEMORY_CATEGORIES },
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
];

/** Tool defs visible to an agent at the given access mode — read/plan agents don't even see memory_save. */
export function getToolDefsForAccessMode(accessMode: ExegolAccessMode): ExegolToolDef[] {
  if (accessMode === "write") return EXEGOL_TOOL_DEFS;
  return EXEGOL_TOOL_DEFS.filter((t) => SEARCH_ONLY_TOOLS.has(t.name));
}

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

function handleMemorySave(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) {
  const fact = String(args.fact ?? "");
  const category = args.category as MemoryCategory;
  if (!fact) throw new ExegolToolError("memory_save requires a non-empty fact", -32602);
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw new ExegolToolError(`memory_save requires a valid category (one of ${MEMORY_CATEGORIES.join(", ")})`, -32602);
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

  const section = typeof args.section === "string" ? args.section : null;
  const result: { brief?: string; digest?: string } = {};

  if (section === "brief" || !section) {
    result.brief = ensureProjectBrief(project.path);
  }
  if (section === "digest" || !section) {
    result.digest = refreshDigestIfStale(project.path).digest;
  }
  return result;
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
    case "memory_save":
      return handleMemorySave(db, args, context);
    case "knowledge_get":
      return handleKnowledgeGet(db, args, context);
  }
}
