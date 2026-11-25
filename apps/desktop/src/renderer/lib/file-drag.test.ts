import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_DRAG_MIME, fileDragToPaste, hasFileDragData, quotePath } from "./file-drag";

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

  it("quotes a path the way the system's shell reads it", () => {
    expect(quotePath("C:\\My Docs\\a.txt", "win32")).toBe('"C:\\My Docs\\a.txt"');
    expect(quotePath("C:\\Docs\\a.txt", "win32")).toBe("C:\\Docs\\a.txt");
    expect(quotePath("/My Docs/it's", "linux")).toBe("'/My Docs/it'\\''s'");
    // A shell would expand or split these
    expect(quotePath("/w/$HOME&(x)", "darwin")).toBe("'/w/$HOME&(x)'");
    expect(quotePath("/w/a-b_c.d@2x", "darwin")).toBe("/w/a-b_c.d@2x");
    expect(quotePath("C:\\R&D\\a.txt", "win32")).toBe('"C:\\R&D\\a.txt"');
    expect(quotePath("C:\\a$b.txt", "win32")).toBe("'C:\\a$b.txt'");
    expect(quotePath("/Fotos/año.png", "darwin")).toBe("/Fotos/año.png");
  });
});
