import type { PipelineRunStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./state-machine";

// ─── canTransition ─────────────────────────────────────────────────────────

describe("canTransition", () => {
  it("allows pending → running", () => {
    expect(canTransition("pending", "running")).toBe(true);
  });

  it("allows running → paused", () => {
    expect(canTransition("running", "paused")).toBe(true);
  });

  it("allows running → completed", () => {
    expect(canTransition("running", "completed")).toBe(true);
  });

  it("allows running → failed", () => {
    expect(canTransition("running", "failed")).toBe(true);
  });

  it("allows running → cancelled", () => {
    expect(canTransition("running", "cancelled")).toBe(true);
  });

  it("allows paused → running", () => {
    expect(canTransition("paused", "running")).toBe(true);
  });

  it("allows paused → cancelled", () => {
    expect(canTransition("paused", "cancelled")).toBe(true);
  });

  it("rejects pending → completed", () => {
    expect(canTransition("pending", "completed")).toBe(false);
  });

  it("rejects pending → paused", () => {
    expect(canTransition("pending", "paused")).toBe(false);
  });

  it("rejects pending → failed", () => {
    expect(canTransition("pending", "failed")).toBe(false);
  });

  it("rejects pending → cancelled", () => {
    expect(canTransition("pending", "cancelled")).toBe(false);
  });
});

// ─── Terminal states ───────────────────────────────────────────────────────

describe("terminal states reject everything", () => {
  const terminalStates: PipelineRunStatus[] = ["completed", "failed", "cancelled"];
  const allStatuses: PipelineRunStatus[] = [
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ];

  for (const from of terminalStates) {
    for (const to of allStatuses) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false);
      });
    }
  }
});

// ─── assertTransition ──────────────────────────────────────────────────────

describe("assertTransition", () => {
  it("returns true for valid transition", () => {
    expect(assertTransition("running", "completed")).toBe(true);
  });

  it("returns false for invalid transition (does not throw)", () => {
    expect(assertTransition("pending", "completed")).toBe(false);
  });

  it("returns false for terminal state transitions", () => {
    expect(assertTransition("completed", "running")).toBe(false);
    expect(assertTransition("failed", "paused")).toBe(false);
    expect(assertTransition("cancelled", "pending")).toBe(false);
  });
});
