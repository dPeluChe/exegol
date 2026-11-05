import type { PipelineRunStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./state-machine";

const ALL_STATUSES: PipelineRunStatus[] = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

const ALLOWED: Partial<Record<PipelineRunStatus, PipelineRunStatus[]>> = {
  pending: ["running", "paused"],
  // A step advance or loop-back stays running: without it multi-step runs stall after step 0
  running: ["running", "paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
};

describe("canTransition", () => {
  it("allows only the listed moves, and nothing out of a terminal state", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = ALLOWED[from]?.includes(to) ?? false;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed);
      }
    }
  });
});

describe("assertTransition", () => {
  it("returns the verdict without throwing", () => {
    expect(assertTransition("running", "completed")).toBe(true);
    expect(assertTransition("pending", "completed")).toBe(false);
    expect(assertTransition("completed", "running")).toBe(false);
    expect(assertTransition("failed", "paused")).toBe(false);
    expect(assertTransition("cancelled", "pending")).toBe(false);
  });
});
