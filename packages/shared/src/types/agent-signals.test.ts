import { describe, expect, it } from "vitest";
import { interruptionAllows } from "./agent-signals";

describe("interruptionAllows", () => {
  it("drops what blocks nobody on Only what needs me", () => {
    expect(interruptionAllows("needs-me", "agent:notice")).toBe(false);
    expect(interruptionAllows("needs-me", "agent:finished")).toBe(false);
    expect(interruptionAllows("needs-me", "budget:warning")).toBe(false);
  });

  it("lets only a credential warning through Nothing", () => {
    expect(interruptionAllows("none", "agent:attention")).toBe(false);
    expect(interruptionAllows("none", "security:warning")).toBe(true);
  });
});
