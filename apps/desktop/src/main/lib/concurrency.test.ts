import { describe, expect, it } from "vitest";
import { createLimiter } from "./concurrency";

describe("createLimiter", () => {
  it("never runs more than the limit at once and runs everything", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = (v: number) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return v;
      });
    const results = await Promise.all([1, 2, 3, 4, 5].map(task));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(await task(6)).toBe(6);
  });

  it("frees the slot when a call throws", async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await run(async () => 1)).toBe(1);
  });
});
