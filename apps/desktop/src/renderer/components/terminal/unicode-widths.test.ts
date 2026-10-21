import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { applyUnicode11Widths } from "./unicode-widths";

// Widths from Go's charmbracelet/x/ansi StringWidthWc (bubbletea v2's default), which is what an
// inline TUI such as Antigravity uses to place its cursor
const MIXED = "• ✅ listo 🚀 → ¿qué? — ⚡ fin";
const MIXED_CELLS = 30;

async function cursorAfter(text: string, unicode11: boolean): Promise<number> {
  const t = new Terminal({ cols: 80, rows: 4, allowProposedApi: true });
  if (unicode11) applyUnicode11Widths(t);
  await new Promise<void>((r) => t.write(text, r));
  const x = t.buffer.active.cursorX;
  t.dispose();
  return x;
}

describe("applyUnicode11Widths", () => {
  it("measures emoji as two cells, like the CLI that drew them", async () => {
    expect(await cursorAfter(MIXED, true)).toBe(MIXED_CELLS);
  });

  it("is needed: xterm's default table puts each of those emoji in one cell", async () => {
    expect(await cursorAfter(MIXED, false)).toBe(MIXED_CELLS - 3);
  });
});
