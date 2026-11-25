import { beforeEach, describe, expect, it, vi } from "vitest";

const rename = vi.hoisted(() => vi.fn());
const renameSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ rename }));
vi.mock("node:fs", () => ({ renameSync }));

import { renameSyncWithRetry, renameWithRetry } from "./rename-retry";

const busy = () => Object.assign(new Error("busy"), { code: "EPERM" });

describe("renameWithRetry", () => {
  beforeEach(() => rename.mockReset());

  it("waits out a file Windows holds for a moment", async () => {
    rename.mockImplementationOnce(async () => {
      throw busy();
    });
    rename.mockImplementationOnce(async () => undefined);
    await renameWithRetry("a", "b", "win32");
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it("refuses at once elsewhere, and on Windows once the tries run out", async () => {
    for (let i = 0; i < 3; i++)
      rename.mockImplementationOnce(async () => {
        throw busy();
      });
    const code = (p: Promise<void>) =>
      p.then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    expect(await code(renameWithRetry("a", "b", "darwin"))).toBe("EPERM");
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await code(renameWithRetry("a", "b", "win32", 2))).toBe("EPERM");
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("waits out a busy file in its synchronous form too", () => {
    renameSync.mockReset();
    renameSync.mockImplementationOnce(() => {
      throw busy();
    });
    renameSyncWithRetry("a", "b", "win32");
    expect(renameSync).toHaveBeenCalledTimes(2);
  });
});
