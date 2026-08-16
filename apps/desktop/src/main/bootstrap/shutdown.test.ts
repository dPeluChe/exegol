import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ exit: vi.fn(), quit: vi.fn() }));
vi.mock("electron", () => ({ app: electronMock }));

const warn = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger", () => ({ logger: { warn, info: vi.fn() } }));

describe("runTeardown", () => {
  beforeEach(() => {
    electronMock.exit.mockClear();
    warn.mockClear();
    vi.resetModules();
  });

  it("runs every step even when one throws", async () => {
    const { runTeardown: fresh } = await import("./shutdown");
    const ran: string[] = [];
    fresh([
      { name: "first", run: () => ran.push("first") },
      {
        name: "boom",
        run: () => {
          throw new Error("nope");
        },
      },
      // The database close lives last precisely because it must not be
      // skippable by an earlier failure.
      { name: "database", run: () => ran.push("database") },
    ]);
    expect(ran).toEqual(["first", "database"]);
  });

  it("refuses to run twice", async () => {
    const { runTeardown: fresh } = await import("./shutdown");
    let calls = 0;
    const steps = [{ name: "once", run: () => calls++ }];
    fresh(steps);
    fresh(steps);
    // will-quit can fire again after a cancelled quit; a second pass over a
    // half-closed database turns a clean exit into a crash.
    expect(calls).toBe(1);
  });

  it("warns instead of pretending an async step finished", async () => {
    const { runTeardown: fresh } = await import("./shutdown");
    // Void-return assignability lets an async step compile; teardown cannot
    // await it, so the only honest thing is to say so.
    fresh([{ name: "async", run: (() => Promise.resolve()) as unknown as () => void }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not await"));
  });
});
