import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("passes the value through and clears its timer", async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, "x")).resolves.toBe(7);
  });

  it("rejects with '<what> timed out' or the given error", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const a = expect(withTimeout(never, 100, "Sidecar ping")).rejects.toThrow(
      "Sidecar ping timed out",
    );
    const b = expect(withTimeout(never, 100, () => new RangeError("custom"))).rejects.toThrow(
      RangeError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await a;
    await b;
    vi.useRealTimers();
  });
});
