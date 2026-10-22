import { afterEach, describe, expect, it, vi } from "vitest";
import { createGhDetector } from "./gh";

const PATH = process.env.PATH;
afterEach(() => {
  process.env.PATH = PATH;
});

describe("createGhDetector", () => {
  it("keeps a miss for 60 s", async () => {
    let t = 0;
    const probe = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const detect = createGhDetector(probe, () => t);
    expect(await detect()).toBe(false);
    t = 59_999;
    expect(await detect()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    t = 60_000;
    expect(await detect()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("asks again at once when PATH changed (the login-shell PATH landed)", async () => {
    const probe = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue({});
    const detect = createGhDetector(probe, () => 0);
    process.env.PATH = "/usr/bin";
    expect(await detect()).toBe(false);
    process.env.PATH = "/opt/homebrew/bin:/usr/bin";
    expect(await detect()).toBe(true);
    expect(await detect()).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("shares one probe between callers at the same time", async () => {
    const probe = vi.fn().mockResolvedValue({});
    const detect = createGhDetector(probe);
    expect(await Promise.all([detect(), detect(), detect()])).toEqual([true, true, true]);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
