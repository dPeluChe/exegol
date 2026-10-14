import { describe, expect, it } from "vitest";
import { createLogLimiter, suppressedNote } from "./log-limiter";

describe("createLogLimiter", () => {
  it("logs once per interval per key and counts what it held back", () => {
    const l = createLogLimiter(1_000);
    expect(l.take("a", 0)).toBe(0);
    expect(l.take("a", 200)).toBeNull();
    expect(l.take("a", 900)).toBeNull();
    expect(l.take("b", 900)).toBe(0);
    expect(l.take("a", 1_000)).toBe(2);
    expect(l.take("a", 1_500)).toBeNull();
  });

  it("a forced line always logs and carries the count", () => {
    const l = createLogLimiter(10_000);
    l.take("a", 0);
    l.take("a", 1);
    expect(l.take("a", 2, true)).toBe(1);
  });

  it("notes only a real count", () => {
    expect(suppressedNote(0)).toBe("");
    expect(suppressedNote(3)).toBe(" (+3 suppressed)");
  });
});
