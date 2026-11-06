import { describe, expect, it } from "vitest";
import { dropCovered, inCell, type LinkRow, wrappedFileMatches } from "./terminal-link-wrap";

const PATH =
  "/private/tmp/claude-501/-Users-me-PROJECTS-code--workspace-cameraman/d99cc3e3-5722-4fb5-8d72-5213985e1dec/scratchpad/music/sierra-mix.mp4";
const COLS = 80;

/** Breaks like a TUI: a real newline at the width, continuation indented */
function tuiRows(text: string, indent = 2): LinkRow[] {
  const rows: LinkRow[] = [];
  const width = COLS - 2 - indent;
  for (let at = 0; at < text.length; at += width) {
    rows.push({ text: " ".repeat(indent) + text.slice(at, at + width), wrapped: false });
  }
  return rows;
}

const rowAtOf = (rows: LinkRow[]) => (y: number) => rows[y - 1] ?? null;

describe("wrappedFileMatches", () => {
  it("joins a path a TUI broke over rows, from any of them", () => {
    const rows = tuiRows(PATH);
    for (const y of [1, 2]) {
      const [match] = wrappedFileMatches(y, rowAtOf(rows), COLS);
      expect(match?.text).toBe(PATH);
      expect(match?.range?.start).toEqual({ x: 3, y: 1 });
      expect(match?.range?.end.y).toBe(2);
    }
  });

  it("joins a folder with its trailing slash, after a label on the first row", () => {
    const folder = `${PATH.slice(0, PATH.lastIndexOf("/"))}/`;
    const label = "Files: ";
    const rows = tuiRows(label + folder);
    const [match] = wrappedFileMatches(1, rowAtOf(rows), COLS);
    expect(match?.text).toBe(folder);
    expect(match?.range?.start.x).toBe(3 + label.length);
  });

  it("joins xterm's own soft wrap", () => {
    const rows = [
      { text: PATH.slice(0, COLS), wrapped: false },
      { text: PATH.slice(COLS), wrapped: true },
    ];
    expect(wrappedFileMatches(2, rowAtOf(rows), COLS)[0]?.text).toBe(PATH);
  });

  it("leaves a short row and a one-row path alone", () => {
    const rows = [
      { text: "see /repo/src/a.ts", wrapped: false },
      { text: "and more", wrapped: false },
    ];
    expect(wrappedFileMatches(1, rowAtOf(rows), COLS)).toEqual([]);
    expect(wrappedFileMatches(2, rowAtOf(rows), COLS)).toEqual([]);
  });
});

describe("wrapped match cells", () => {
  const range = { start: { x: 5, y: 1 }, end: { x: 10, y: 3 } };
  const wrapped = { text: "/a/b.ts", index: 0, length: 7, range };

  it("hits every cell of the path, and only those", () => {
    expect(inCell(wrapped, 3, 1)).toBe(false);
    expect(inCell(wrapped, 4, 1)).toBe(true);
    expect(inCell(wrapped, 70, 2)).toBe(true);
    expect(inCell(wrapped, 9, 3)).toBe(true);
    expect(inCell(wrapped, 10, 3)).toBe(false);
  });

  it("treats a one-row match as its own columns", () => {
    const m = { text: "src/a.ts", index: 4, length: 7 };
    expect([3, 4, 10, 11].map((col) => inCell(m, col, 1))).toEqual([false, true, true, false]);
  });

  it("drops a piece the whole path covers, keeps what sits beside it", () => {
    const piece = { text: "/a/", index: 4, length: 3 };
    const beside = { text: "x.ts", index: 1, length: 2 };
    expect(dropCovered([wrapped, piece, beside], 1)).toEqual([wrapped, beside]);
  });
});
