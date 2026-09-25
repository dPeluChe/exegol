import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_DRAG_MIME, fileDragToPaste, hasFileDragData } from "./file-drag";

type Drag = Parameters<typeof fileDragToPaste>[0];

function drag(data: Record<string, string>, files: { name: string }[] = []): Drag {
  const types = [...Object.keys(data), ...(files.length ? ["Files"] : [])];
  return {
    dataTransfer: { types, getData: (t: string) => data[t] ?? "", files },
  } as unknown as Drag;
}

describe("file drops on a terminal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pastes Exegol's own drags as @mentions", () => {
    const e = drag({ [FILE_DRAG_MIME]: JSON.stringify([{ relPath: "src/app.ts" }]) });
    expect(fileDragToPaste(e)).toBe("@src/app.ts ");
  });

  it("accepts files from Finder and pastes their absolute paths, quoted when needed", () => {
    vi.stubGlobal("window", {
      api: { pathForFile: (f: { name: string }) => `/Users/me/My Docs/${f.name}` },
    });
    const e = drag({}, [{ name: "notes.md" }, { name: "a.txt" }]);
    expect(hasFileDragData(e)).toBe(true);
    expect(fileDragToPaste(e)).toBe("'/Users/me/My Docs/notes.md' '/Users/me/My Docs/a.txt' ");
  });

  it("ignores drags that carry no files", () => {
    expect(hasFileDragData(drag({ "text/plain": "hi" }))).toBe(false);
  });
});
