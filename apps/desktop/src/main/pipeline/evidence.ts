import type { PipelineRun, PipelineTemplate } from "@exegol/shared";
import type Database from "libsql";
import { getAgentScore } from "../db/queries";
import { logger } from "../lib/logger";
import { getApiKey } from "../security/keystore";

/**
 * T130 — Pipeline Evidence. Per-step diff + scrollback tail are already
 * captured by pipeline-step-handler.ts; this module adds the two missing
 * pieces: an AI diff summary (reusing the diff.ts Haiku commit-message
 * pattern) and a markdown run report for PR descriptions. Both are
 * best-effort — evidence gaps must never break pipeline execution.
 */

const MAX_DIFF_CHARS = 20_000;

/** Summarize a step's diff in 1-2 sentences via Haiku. Empty string on any
 *  failure (no API key, empty diff, network error) — never throws. */
export async function summarizeStepDiff(
  db: Database.Database,
  diff: string,
  stepLabel: string,
): Promise<string> {
  if (!diff.trim()) return "";
  const apiKey = getApiKey(db, "anthropic");
  if (!apiKey) return "";

  const truncated = diff.slice(0, MAX_DIFF_CHARS);
  const prompt = `You are summarizing what a pipeline step ("${stepLabel}") changed, for a reviewer scanning a PR.

Diff:

${truncated}

Respond with 1-2 short sentences describing what changed and why, in plain prose.
No markdown, no bullet points, no preamble.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return (data.content?.[0]?.text ?? "").trim();
  } catch (err) {
    logger.warn("[Evidence] AI diff summary failed (non-fatal):", err);
    return "";
  }
}

/** Look up the step agent's overall score, if scoring has completed. */
export function attachStepScore(db: Database.Database, agentId: string | null): number | null {
  if (!agentId) return null;
  try {
    return getAgentScore(db, agentId)?.overallScore ?? null;
  } catch {
    return null;
  }
}

/** Build a per-step markdown report of a run, suitable for a PR description. */
export function buildRunReport(run: PipelineRun, template: PipelineTemplate | null): string {
  const lines: string[] = [];
  lines.push(`# Pipeline Run: ${template?.name ?? run.templateId}`);
  lines.push("");
  lines.push(`**Task:** ${run.originalTask}`);
  lines.push(`**Status:** ${run.status}`);
  if (run.iterationCount > 0)
    lines.push(`**Iterations:** ${run.iterationCount}/${run.maxIterations}`);
  lines.push("");

  for (const result of run.stepResults) {
    const stepDef = template?.steps[result.stepIndex];
    lines.push(`## Step ${result.stepIndex + 1}: ${stepDef?.label ?? `step ${result.stepIndex}`}`);
    lines.push("");
    lines.push(`- **Status:** ${result.status}`);
    lines.push(`- **Provider:** ${stepDef?.cliType ?? "unknown"}`);
    if (result.score != null) lines.push(`- **Score:** ${result.score}`);
    if (result.startedAt) {
      const secs = (result.completedAt ?? result.startedAt) - result.startedAt;
      lines.push(`- **Duration:** ${secs}s`);
    }
    lines.push("");

    if (result.aiSummary) {
      lines.push(result.aiSummary);
      lines.push("");
    }

    if (result.diffSummary.trim()) {
      lines.push("<details><summary>Diff</summary>");
      lines.push("");
      lines.push("```diff");
      lines.push(result.diffSummary.trim());
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n");
}
