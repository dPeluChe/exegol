import type { PipelineStepDef, PipelineStepResult } from "@exegol/shared";

// ─── Default role-based prompt templates ───────────────────────────────────

const DEFAULT_TEMPLATES: Record<string, string> = {
  implement:
    "Implement the following task:\n\n{{task}}\n\nWrite clean, production-quality code. Commit when done.",
  review:
    "Review the changes made for the following task:\n\n{{task}}\n\nGit diff of changes so far:\n```\n{{diff}}\n```\n\nPrevious agent output:\n{{previousOutput}}\n\nIf there are issues, exit with code 1 and explain what needs fixing. If the code looks good, exit with code 0.",
  fix: "Fix the issues found in the review for task:\n\n{{task}}\n\nReview feedback:\n{{previousOutput}}\n\nGit diff of current changes:\n```\n{{diff}}\n```\n\nFix iteration: {{iteration}}. Address all review comments and commit.",
  verify:
    "Verify the final implementation of:\n\n{{task}}\n\nGit diff:\n```\n{{diff}}\n```\n\nRun tests if available. Confirm everything works. Exit 0 if good, exit 1 if issues remain.",
  custom: "{{task}}",
};

/**
 * Build the prompt for a pipeline step by resolving template variables.
 */
const PR_INSTRUCTION =
  "\n\nIMPORTANT: When all work is complete, create a Pull Request to main with a clear title and description summarizing the changes. Use `gh pr create` or the equivalent git workflow.";

export function buildStepPrompt(
  step: PipelineStepDef,
  vars: {
    task: string;
    diff: string;
    previousOutput: string;
    iteration: number;
    isLastStep?: boolean;
    /** T140: progressive-disclosure pointer block to `.exegol/knowledge/`. */
    knowledge?: string;
    retryFeedback?: string;
  },
): string {
  const template =
    step.promptTemplate?.trim() ||
    DEFAULT_TEMPLATES[step.role] ||
    DEFAULT_TEMPLATES.custom ||
    "{{task}}";

  let prompt = template
    .replace(/\{\{task\}\}/g, vars.task)
    .replace(/\{\{diff\}\}/g, vars.diff)
    .replace(/\{\{previousOutput\}\}/g, vars.previousOutput)
    .replace(/\{\{iteration\}\}/g, String(vars.iteration))
    .replace(/\{\{knowledge\}\}/g, vars.knowledge ?? "");
    .replace(/\{\{retryFeedback\}\}/g, vars.retryFeedback ?? "");

  // Auto-inject PR instruction on the last step (unless user already mentioned PR)
  if (
    vars.isLastStep &&
    !prompt.toLowerCase().includes("pull request") &&
    !prompt.includes("gh pr")
  ) {
    prompt += PR_INSTRUCTION;
  }

  return prompt;
}

/**
 * Extract a summary from step results for the "previousOutput" variable.
 * Returns the outputSummary of the last completed/failed step.
 */
export function getPreviousOutput(stepResults: PipelineStepResult[]): string {
  for (let i = stepResults.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounds guarantee valid index
    const r = stepResults[i]!;
    if (r.status === "completed" || r.status === "failed") {
      return r.outputSummary || "(no output captured)";
    }
  }
  return "(no previous output)";
}

/**
 * T88v2 — most recent evaluator "retry" verdict's feedback, for the
 * {{retryFeedback}} template variable on the loop-back step.
 */
export function getRetryFeedback(stepResults: PipelineStepResult[]): string {
  for (let i = stepResults.length - 1; i >= 0; i--) {
    const r = stepResults[i];
    if (r?.verdict?.decision === "retry" && r.verdict.feedback) {
      return r.verdict.feedback;
    }
  }
  return "";
}
