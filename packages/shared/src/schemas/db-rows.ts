/**
 * T77: Zod schemas for raw SQLite DB rows (snake_case).
 *
 * Each schema validates the shape that comes out of `db.prepare().get/all()`
 * before the mapper converts it to the camelCase business type. This catches:
 *   - Missing columns after a failed migration
 *   - Wrong column types (string where number expected)
 *   - Null where non-null expected
 *
 * Performance: parse is called once per row at the query boundary, not on
 * every intermediate operation. For list queries the cost is ~0.1ms per row
 * (Zod parse is fast for flat objects).
 */

import { z } from "zod";
import { AGENT_ACCESS_MODES, AGENT_CLI_TYPES, AGENT_STATUSES } from "../types/agent";
import { PROMPT_CATEGORIES } from "../types/prompt";

// ─── Helpers ────────────────────────────────────────────────────────────

/** SQLite returns 0/1 for booleans — coerce to boolean. Output: boolean. */
const sqlBool = z.preprocess((v) => Boolean(v), z.boolean());

/**
 * SQLite nullable fields: accepts string/number or null. If the column
 * is missing (undefined — e.g., pre-migration row), `.catch(null)` returns
 * null silently instead of failing validation. Output: `string | null`.
 */
const optStr = z.string().nullable().catch(null);
const optNum = z.number().nullable().catch(null);

// ─── Row schemas ────────────────────────────────────────────────────────

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  git_remote: optStr,
  default_branch: z.string(),
  default_ide: z.string(),
  created_at: z.number(),
  last_opened_at: z.number(),
});

export const agentRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  worktree_id: optStr,
  branch_name: optStr,
  cli_type: z.enum(AGENT_CLI_TYPES),
  status: z.enum(AGENT_STATUSES),
  task_description: z.string(),
  current_step: optStr,
  pid: optNum,
  started_at: optNum,
  stopped_at: optNum,
  access_mode: z.enum(AGENT_ACCESS_MODES).catch("write"),
});

export const worktreeRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  agent_id: optStr,
  path: z.string(),
  branch_name: z.string(),
  auto_cleanup: sqlBool,
  disk_usage_bytes: z.number(),
  created_at: z.number(),
});

export const promptRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  content: z.string(),
  category: z.enum(PROMPT_CATEGORIES),
  pinned: sqlBool,
  created_at: z.number(),
  updated_at: z.number(),
});

export const scheduledTaskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  prompt: z.string(),
  cron_expression: z.string(),
  skill_name: optStr,
  cli_agent: z.string(),
  max_token_budget: optNum,
  last_run_at: optNum,
  next_run_at: optNum,
  last_result_status: optStr,
  enabled: sqlBool,
  depends_on: optStr,
});

export const scheduledResultRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  agent_id: z.string(),
  status: z.string(),
  summary: z.string(),
  created_at: z.number(),
});

export const tokenUsageRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  provider: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  estimated_cost_usd: z.number(),
  tool_call_count: z.number(),
  recorded_at: z.number(),
});

export const activityRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  agent_id: optStr,
  type: z.string(),
  title: z.string(),
  detail: optStr,
  created_at: z.number(),
});

export const memoryRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  agent_id: optStr,
  content: z.string(),
  source: z.string(),
  relevance_score: z.number().catch(0),
  created_at: z.number(),
});

export const scoreRowSchema = z.object({
  agent_id: z.string(),
  exit_code: optNum,
  duration_sec: optNum,
  lines_added: optNum,
  lines_removed: optNum,
  files_changed: optNum,
  test_pass: optNum,
  test_fail: optNum,
  git_score: optNum,
  llm_clarity: optNum,
  llm_completeness: optNum,
  llm_correctness: optNum,
  llm_score: optNum,
  composite_score: optNum,
});

export const oplogRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  project_id: z.string(),
  operation: z.string(),
  file_path: optStr,
  detail: optStr,
  reversible: sqlBool,
  undone: sqlBool,
  created_at: z.number(),
});

export const queueTaskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  cli_type: z.string(),
  task_description: z.string(),
  priority: z.number(),
  status: z.string(),
  created_at: z.number(),
  started_at: optNum,
});

export const messageRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  role: z.string(),
  content: z.string(),
  created_at: z.number(),
});

export const skillStateRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  skill_name: z.string(),
  enabled: sqlBool,
  config_json: optStr,
  updated_at: z.number(),
});

// ─── Parse helper ───────────────────────────────────────────────────────

/**
 * Validate a raw DB row against a Zod schema. On failure, logs a warning
 * and returns the raw data with a forced cast so the app doesn't crash —
 * but the log gives us a trail to find the migration gap.
 *
 * Uses `z.ZodTypeAny` + `z.output<S>` instead of `z.ZodType<T>` so
 * composite schemas (ZodCatch, ZodEffects from .catch/.preprocess) infer
 * their output types correctly through the generic.
 */
export function parseRow<S extends z.ZodTypeAny>(
  schema: S,
  row: unknown,
  context?: string,
): z.output<S> {
  const result = schema.safeParse(row);
  if (result.success) return result.data;
  // Log but don't throw — graceful degradation
  console.warn(
    `[DB] Row validation failed${context ? ` (${context})` : ""}:`,
    result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
  );
  return row as z.output<S>;
}
