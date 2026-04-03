import { describe, expect, it } from "vitest";
import { buildStepPrompt, getPreviousOutput } from "./context";
import type { PipelineStepDef, PipelineStepResult } from "@exegol/shared";

function makeStep(overrides: Partial<PipelineStepDef> = {}): PipelineStepDef {
  return {
    cliType: "claude-code",
    role: "implement",
    label: "Implement",
    promptTemplate: "",
    allowFailure: false,
    loopBackTo: undefined,
    ...overrides,
  };
}

function makeStepResult(
  overrides: Partial<PipelineStepResult> = {},
): PipelineStepResult {
  return {
    stepIndex: 0,
    iteration: 0,
    agentId: null,
    status: "completed",
    exitCode: 0,
    outputSummary: "Done",
    diffSummary: "",
    startedAt: 0,
    completedAt: 0,
    ...overrides,
  };
}

// ─── buildStepPrompt ────────────────────────────────────────────────────

describe("buildStepPrompt", () => {
  it("should use default implement template when no template provided", () => {
    const step = makeStep({ role: "implement", promptTemplate: "" });
    const prompt = buildStepPrompt(step, {
      task: "Add login page",
      diff: "",
      previousOutput: "",
      iteration: 0,
    });
    expect(prompt).toContain("Add login page");
  });

  it("should interpolate {{task}} variable", () => {
    const step = makeStep({
      promptTemplate: "Please complete: {{task}}",
    });
    const prompt = buildStepPrompt(step, {
      task: "Fix auth bug",
      diff: "",
      previousOutput: "",
      iteration: 0,
    });
    expect(prompt).toBe("Please complete: Fix auth bug");
  });

  it("should interpolate {{diff}} variable", () => {
    const step = makeStep({
      promptTemplate: "Diff:\n{{diff}}",
    });
    const prompt = buildStepPrompt(step, {
      task: "",
      diff: "+added line\n-removed line",
      previousOutput: "",
      iteration: 0,
    });
    expect(prompt).toContain("+added line");
    expect(prompt).toContain("-removed line");
  });

  it("should interpolate {{previousOutput}} variable", () => {
    const step = makeStep({
      role: "fix",
      promptTemplate: "",
    });
    const prompt = buildStepPrompt(step, {
      task: "Fix tests",
      diff: "",
      previousOutput: "3 tests failing in auth module",
      iteration: 1,
    });
    expect(prompt).toContain("3 tests failing in auth module");
  });

  it("should interpolate {{iteration}} variable", () => {
    const step = makeStep({
      promptTemplate: "Attempt {{iteration}}",
    });
    const prompt = buildStepPrompt(step, {
      task: "",
      diff: "",
      previousOutput: "",
      iteration: 3,
    });
    expect(prompt).toContain("Attempt 3");
  });

  it("should inject PR instruction on last step", () => {
    const step = makeStep({
      role: "implement",
      promptTemplate: "",
    });
    const prompt = buildStepPrompt(step, {
      task: "Add feature",
      diff: "",
      previousOutput: "",
      iteration: 0,
      isLastStep: true,
    });
    expect(prompt).toContain("Pull Request");
    expect(prompt).toContain("gh pr create");
  });

  it("should NOT inject PR instruction when not last step", () => {
    const step = makeStep({
      role: "implement",
      promptTemplate: "",
    });
    const prompt = buildStepPrompt(step, {
      task: "Add feature",
      diff: "",
      previousOutput: "",
      iteration: 0,
      isLastStep: false,
    });
    expect(prompt).not.toContain("Pull Request");
  });

  it("should NOT inject PR instruction when template already mentions PR", () => {
    const step = makeStep({
      promptTemplate: "Create a Pull Request for: {{task}}",
    });
    const prompt = buildStepPrompt(step, {
      task: "Fix bug",
      diff: "",
      previousOutput: "",
      iteration: 0,
      isLastStep: true,
    });
    // Should only contain the template's PR mention, not the auto-injected one
    const prCount = prompt.toLowerCase().split("pull request").length - 1;
    expect(prCount).toBe(1);
  });

  it("should replace all occurrences of {{task}}", () => {
    const step = makeStep({
      promptTemplate: "Task: {{task}}\nReminder: {{task}}",
    });
    const prompt = buildStepPrompt(step, {
      task: "Refactor",
      diff: "",
      previousOutput: "",
      iteration: 0,
    });
    expect(prompt).toContain("Task: Refactor");
    expect(prompt).toContain("Reminder: Refactor");
  });

  it("should fall back to custom template for unknown roles", () => {
    const step = makeStep({
      role: "custom" as PipelineStepDef["role"],
      promptTemplate: "",
    });
    const prompt = buildStepPrompt(step, {
      task: "Custom work",
      diff: "",
      previousOutput: "",
      iteration: 0,
    });
    expect(prompt).toContain("Custom work");
  });
});

// ─── getPreviousOutput ──────────────────────────────────────────────────

describe("getPreviousOutput", () => {
  it("should return last completed step output", () => {
    const results = [
      makeStepResult({
        stepIndex: 0,
        status: "completed",
        outputSummary: "Step 0 done",
      }),
      makeStepResult({
        stepIndex: 1,
        status: "completed",
        outputSummary: "Step 1 done",
      }),
    ];
    expect(getPreviousOutput(results)).toBe("Step 1 done");
  });

  it("should return last failed step output", () => {
    const results = [
      makeStepResult({
        stepIndex: 0,
        status: "completed",
        outputSummary: "Step 0 done",
      }),
      makeStepResult({
        stepIndex: 1,
        status: "failed",
        outputSummary: "Step 1 failed: tests error",
      }),
    ];
    expect(getPreviousOutput(results)).toBe("Step 1 failed: tests error");
  });

  it("should skip running/pending steps", () => {
    const results = [
      makeStepResult({
        stepIndex: 0,
        status: "completed",
        outputSummary: "Step 0 done",
      }),
      makeStepResult({
        stepIndex: 1,
        status: "running",
        outputSummary: "",
      }),
    ];
    expect(getPreviousOutput(results)).toBe("Step 0 done");
  });

  it("should return default for empty results", () => {
    expect(getPreviousOutput([])).toBe("(no previous output)");
  });

  it("should return default when no completed/failed steps", () => {
    const results = [
      makeStepResult({ status: "pending", outputSummary: "" }),
      makeStepResult({ status: "running", outputSummary: "working..." }),
    ];
    expect(getPreviousOutput(results)).toBe("(no previous output)");
  });

  it("should handle missing outputSummary", () => {
    const results = [
      makeStepResult({
        status: "completed",
        outputSummary: "",
      }),
    ];
    expect(getPreviousOutput(results)).toBe("(no output captured)");
  });
});
