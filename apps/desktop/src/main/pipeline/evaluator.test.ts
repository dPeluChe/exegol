import { DEFAULT_EVALUATOR_GATE_POLICY } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { decide, runEvaluatorGate } from "./evaluator";

describe("decide", () => {
  it("ships when avgScore meets the ship threshold", () => {
    expect(decide(0.7, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("ship");
    expect(decide(1, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("ship");
  });

  it("holds when avgScore is between hold and ship thresholds", () => {
    expect(decide(0.4, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("hold");
    expect(decide(0.65, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("hold");
  });

  it("retries when avgScore is below the hold threshold", () => {
    expect(decide(0, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("retry");
    expect(decide(0.39, DEFAULT_EVALUATOR_GATE_POLICY)).toBe("retry");
  });

  it("respects a custom gate policy", () => {
    const policy = { shipThreshold: 0.9, holdThreshold: 0.6 };
    expect(decide(0.85, policy)).toBe("hold");
    expect(decide(0.9, policy)).toBe("ship");
  });
});

describe("runEvaluatorGate", () => {
  it("holds for human review when no API key is configured (no network call)", async () => {
    const verdict = await runEvaluatorGate(null, "diff", "criteria");
    expect(verdict).toEqual({
      decision: "hold",
      scores: [],
      avgScore: 0,
      feedback: "",
      costUsd: 0,
    });
  });
});
