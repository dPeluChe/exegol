import { describe, expect, it } from "vitest";
import { readableStep } from "./readable-step";

describe("readableStep", () => {
  it("keeps ordinary steps", () => {
    expect(readableStep("Tool: Read")).toBe("Tool: Read");
    expect(readableStep("Running npm test")).toBe("Running npm test");
  });

  it("drops a TUI status bar made of glyphs (the devin case)", () => {
    expect(readableStep('1 shell · ↓ select ⡿⣿⣿ ⣿⣿ 6"')).toBeUndefined();
    expect(readableStep("│ ╭──────────╮ │")).toBeUndefined();
    expect(readableStep("⠋⠙⠹")).toBeUndefined();
  });

  it("keeps the words when a line only carries a spinner or icon", () => {
    expect(readableStep("⠋ Thinking about the schema")).toBe("Thinking about the schema");
  });

  it("returns undefined for nothing", () => {
    expect(readableStep(undefined)).toBeUndefined();
    expect(readableStep("")).toBeUndefined();
  });
});

describe("readableScrape", () => {
  it("drops the status that came from a chrome line along with its step", async () => {
    const { readableScrape } = await import("./agent-output-processor");
    expect(readableScrape("waiting_input", "│ ⡿ continue? │")).toEqual({
      status: undefined,
      currentStep: undefined,
    });
    expect(readableScrape("running", "Tool: Read")).toEqual({
      status: "running",
      currentStep: "Tool: Read",
    });
    // No step at all: the status stands on its own
    expect(readableScrape("waiting_input", undefined).status).toBe("waiting_input");
  });
});
