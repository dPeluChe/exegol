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
export function buildStepPrompt(
  step: PipelineStepDef,
  vars: {
    task: string;
    diff: string;
    previousOutput: string;
    iteration: number;
  },
): string {
  const template =
    step.promptTemplate?.trim() ||
    DEFAULT_TEMPLATES[step.role] ||
    DEFAULT_TEMPLATES.custom ||
    "{{task}}";

  return template
    .replace(/\{\{task\}\}/g, vars.task)
    .replace(/\{\{diff\}\}/g, vars.diff)
    .replace(/\{\{previousOutput\}\}/g, vars.previousOutput)
    .replace(/\{\{iteration\}\}/g, String(vars.iteration));
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
