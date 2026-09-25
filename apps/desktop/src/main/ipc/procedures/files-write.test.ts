import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock("./project-paths", () => ({
  allowedBases: () => [],
  assertPathInsideProject: async () => {},
}));

const { filesRouter } = await import("./files");
const caller = filesRouter.createCaller({} as never);

describe("files.writeFile conflict check", () => {
  const file = join(mkdtempSync(join(tmpdir(), "exegol-write-")), "a.txt");

  it("writes when the file is still at the edit base, and returns the new mtime", async () => {
    writeFileSync(file, "one");
    const base = statSync(file).mtimeMs;
    const res = await caller.writeFile({ path: file, content: "two", expectedMtimeMs: base });
    expect(readFileSync(file, "utf-8")).toBe("two");
    expect(res.mtimeMs).toBe(statSync(file).mtimeMs);
  });

  it("refuses with the message the viewer matches when the file changed on disk", async () => {
    writeFileSync(file, "agent wrote this");
    const stale = statSync(file).mtimeMs - 1000;
    // The renderer only sees the message (the code is lost over IPC) and matches "changed on disk"
    await expect(
      caller.writeFile({ path: file, content: "mine", expectedMtimeMs: stale }),
    ).rejects.toThrow(/changed on disk/);
    expect(readFileSync(file, "utf-8")).toBe("agent wrote this");
  });
});
