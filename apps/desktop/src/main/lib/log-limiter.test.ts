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

  it("forget and reset let the next line through", () => {
    const l = createLogLimiter(1_000);
    l.take("a", 0);
    l.take("b", 0);
    l.forget("a");
    expect(l.take("a", 1)).toBe(0);
    l.reset();
    expect(l.take("b", 2)).toBe(0);
  });

  it("caps its keys: stale ones go first, then the oldest", () => {
    const l = createLogLimiter(1_000, 3);
    l.take("a", 0);
    l.take("b", 0);
    l.take("c", 500);
    l.take("d", 1_200);
    expect(l.size).toBe(2);
    expect(l.take("c", 1_300)).toBeNull();
    l.take("e", 1_400);
    l.take("f", 1_400);
    expect(l.size).toBe(3);
    expect(l.take("c", 1_450)).toBe(0);
  });

  it("notes only a real count", () => {
    expect(suppressedNote(0)).toBe("");
    expect(suppressedNote(3)).toBe(" (+3 suppressed)");
  });
});
