import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock("./project-paths", () => ({
  allowedBases: () => [],
  assertPathInsideProject: async () => {},
}));

const { decodeText, filesRouter } = await import("./files");
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

describe("decodeText", () => {
  it("keeps UTF-8 editable and shows Latin-1 / CP1252 read-only instead of turning it into U+FFFD", () => {
    expect(decodeText(Buffer.from("│ ó ñ", "utf-8"))).toEqual({ content: "│ ó ñ", notUtf8: false });
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x78, 0x94]); // café “x” in CP1252
    expect(decodeText(latin1)).toEqual({ content: "café \u201cx\u201d", notUtf8: true });
  });
});
