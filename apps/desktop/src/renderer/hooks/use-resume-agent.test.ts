import { describe, expect, it, vi } from "vitest";
import { onceAtATime } from "./use-resume-agent";

describe("onceAtATime", () => {
  it("a second resume of the same session, while the first runs or after it, does nothing", async () => {
    const fn = vi.fn(() => new Promise<void>((r) => setTimeout(r, 5)));
    await Promise.all([onceAtATime("s1", fn), onceAtATime("s1", fn)]);
    await onceAtATime("s1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a failed resume can be tried again", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("spawn failed");
    };
    await expect(onceAtATime("s2", failing)).rejects.toThrow();
    await expect(onceAtATime("s2", failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
